"use client";

/**
 * 事業所の地図（Leaflet）
 *
 * 見た目はつむぐの地図（src/components/DistributionMap.tsx）に揃えている
 * （2026-10-13、ユーザーの指摘「つむぐの地図と比べて情報や色が多くて見にくい」）。
 * - 既定は「白地図」（Esri World Light Gray Base）。地名の文字が無く、道路と街区の
 *   輪郭だけなので、事業所の点がいちばん見やすい。APIキー不要・無料・透かし無し。
 * - 白地図には地名が無いので、主要駅・区の名前をつむぐと同じ控えめなラベルで重ねる
 *   （src/lib/landmarks.ts、つむぐの写し）。駅は拡大したときだけ出す。
 * - 「淡色」に切り替えると国土地理院の淡色地図（地名入り）。こちらはラベルを重ねない。
 * - 事業所の点は canvas でまとめて描く（千件でも軽い）。点の色＝サービスの種類。
 *   縁取りは白で統一（2色の縁取りはごちゃつくのでやめた）。
 * - 同じ場所に複数の事業所があるときは、少し大きい点を1つだけ描き、
 *   押したら先頭の事業所を選ぶ（一覧側に「ほかにN件」と出す）。
 */

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { CHIBA_LANDMARKS } from "@/lib/landmarks";
import { categoryColor, type CategoryId, type LatLng, type Office } from "@/lib/offices";

type TileStyle = "white" | "pale";

const TILES: Record<TileStyle, { url: string; label: string; attribution: string; maxNativeZoom: number }> = {
  white: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    label: "白地図",
    attribution:
      '&copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, &copy; OpenStreetMap',
    maxNativeZoom: 16,
  },
  pale: {
    url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
    label: "淡色",
    attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    maxNativeZoom: 18,
  },
};

export type MapOffice = Office & { distance: number | null };

type Props = {
  center: LatLng & { label: string };
  radiusKm: number;
  offices: MapOffice[];
  activeCategories: Record<CategoryId, boolean>;
  selectedId: string | null;
  onSelect: (id: string, sameSpot: number) => void;
  /** 値が変わるたびに、範囲の円全体が入るように合わせる */
  fitToken: number;
  /** 値が変わるたびに、選んだ事業所へ寄る */
  focus: { lat: number; lng: number; token: number } | null;
};

const SELF_ICON_HTML =
  '<div class="pin"><svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="#1d5d66" stroke="#fff" stroke-width="2.5"></circle><path d="M8.5 14.5 14 9.5l5.5 5v5.5h-3.6v-3.8h-3.8V20H8.5z" fill="#fff"></path></svg><span>自社</span></div>';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function OfficeMap({ center, radiusKm, offices, activeCategories, selectedId, onSelect, fitToken, focus }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const tileRef = useRef<Leaflet.TileLayer | null>(null);
  const officeLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const landmarkLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const rendererRef = useRef<Leaflet.Canvas | null>(null);
  const circleRef = useRef<Leaflet.Circle | null>(null);
  const selfRef = useRef<Leaflet.Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(14);
  const [tileStyle, setTileStyle] = useState<TileStyle>("white");

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // 地図の初期化（1回だけ）
  useEffect(() => {
    let alive = true;
    import("leaflet").then((L) => {
      if (!alive || !boxRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(boxRef.current, {
        center: [center.lat, center.lng],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
        zoomSnap: 0.5,
      });
      L.control.zoom({ position: "topright", zoomInTitle: "拡大", zoomOutTitle: "縮小" }).addTo(map);
      L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
      rendererRef.current = L.canvas({ padding: 0.3, tolerance: 6 });
      circleRef.current = L.circle([center.lat, center.lng], {
        radius: radiusKm * 1000,
        color: "#1d5d66",
        weight: 1.5,
        opacity: 0.7,
        dashArray: "5 6",
        fill: false,
        interactive: false,
      }).addTo(map);
      landmarkLayerRef.current = L.layerGroup().addTo(map);
      officeLayerRef.current = L.layerGroup().addTo(map);
      selfRef.current = L.marker([center.lat, center.lng], {
        icon: L.divIcon({ className: "self-pin", html: SELF_ICON_HTML, iconSize: undefined }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000,
      }).addTo(map);
      map.on("zoomend", () => setZoom(map.getZoom()));
      map.fitBounds(circleRef.current.getBounds(), { padding: [12, 12] });
      setZoom(map.getZoom());
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      alive = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // 中心・半径の変化は下の effect で反映する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 箱の大きさが変わったら（画面回転・PC表示など）地図に知らせる
  useEffect(() => {
    if (!ready || !boxRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => mapRef.current?.invalidateSize());
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [ready]);

  // 地図タイル（出典と最大拡大が違うので、切り替えのたびに作り直す）
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const t = TILES[tileStyle];
    tileRef.current = L.tileLayer(t.url, {
      attribution: t.attribution,
      maxZoom: 18,
      maxNativeZoom: t.maxNativeZoom,
      minZoom: 9,
    }).addTo(map);
  }, [ready, tileStyle]);

  // 駅・区の名前（白地図のときだけ。淡色地図には地名が入っている）
  useEffect(() => {
    const L = LRef.current;
    const layer = landmarkLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (tileStyle !== "white") return;
    for (const item of CHIBA_LANDMARKS) {
      let html: string;
      let className: string;
      let anchor: [number, number];
      if (item.type === "station") {
        // つむぐと同じ：主要駅は zoom 13 から、各駅は 14 から
        if (item.priority === 1 && zoom < 13) continue;
        if (item.priority === 2 && zoom < 14) continue;
        const name = item.shortName.endsWith("駅") ? item.shortName : `${item.shortName}駅`;
        html = `<span>${escapeHtml(name)}</span>`;
        className = "landmark-station";
        anchor = [20, 8];
      } else if (item.type === "facility") {
        if (zoom < 13) continue;
        html = `<span>${escapeHtml(item.shortName)}</span>`;
        className = "landmark-station";
        anchor = [24, 8];
      } else {
        if (zoom < 12) continue;
        html = `<span>${escapeHtml(item.shortName)}</span>`;
        className = "landmark-area";
        anchor = [25, 8];
      }
      L.marker([item.lat, item.lng], {
        icon: L.divIcon({ html, className, iconSize: [0, 0], iconAnchor: anchor }),
        interactive: false,
        keyboard: false,
        zIndexOffset: item.type === "area" ? 150 : 310,
      }).addTo(layer);
    }
  }, [ready, tileStyle, zoom]);

  // 中心・半径
  useEffect(() => {
    if (!ready) return;
    circleRef.current?.setLatLng([center.lat, center.lng]).setRadius(radiusKm * 1000);
    selfRef.current?.setLatLng([center.lat, center.lng]);
  }, [ready, center.lat, center.lng, radiusKm]);

  // 範囲全体に合わせる
  useEffect(() => {
    if (!ready || !circleRef.current || !mapRef.current) return;
    mapRef.current.fitBounds(circleRef.current.getBounds(), { padding: [12, 12] });
  }, [ready, fitToken]);

  // 選んだ事業所へ寄る
  useEffect(() => {
    if (!ready || !focus || !mapRef.current) return;
    const map = mapRef.current;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [ready, focus]);

  // 事業所の点
  useEffect(() => {
    const L = LRef.current;
    const layer = officeLayerRef.current;
    const renderer = rendererRef.current;
    if (!ready || !L || !layer || !renderer) return;
    layer.clearLayers();
    const r = zoom < 12.5 ? 4 : zoom < 14 ? 5.5 : 7;
    const groups = new Map<string, MapOffice[]>();
    for (const o of offices) {
      if (o.lat == null || o.lng == null || o.self) continue;
      const key = `${o.lat.toFixed(5)},${o.lng.toFixed(5)}`;
      const g = groups.get(key) ?? [];
      g.push(o);
      groups.set(key, g);
    }
    let selected: MapOffice | null = null;
    for (const g of groups.values()) {
      const o = g[0];
      // 絞り込みで表示中の種類のうち、いちばん先のものの色で塗る
      const color = categoryColor(o.categories.find((c) => activeCategories[c]) ?? o.categories[0]);
      const m = L.circleMarker([o.lat as number, o.lng as number], {
        renderer,
        radius: r + (g.length > 1 ? 1 : 0),
        fillColor: color,
        fillOpacity: 0.9,
        color: "#ffffff",
        weight: 1.5,
      });
      m.on("click", () => onSelectRef.current(o.id, g.length));
      m.addTo(layer);
      const hit = g.find((x) => x.id === selectedId);
      if (hit) selected = hit;
    }
    if (selected && selected.lat != null && selected.lng != null) {
      L.circleMarker([selected.lat, selected.lng], {
        renderer,
        radius: r + 6,
        weight: 3,
        fill: false,
        color: "#1d5d66",
        interactive: false,
      }).addTo(layer);
    }
  }, [ready, offices, activeCategories, selectedId, zoom]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-rule">
      <div ref={boxRef} className="absolute inset-0" aria-label="事業所の地図" />
      <div className="absolute left-2 top-2 z-[800] flex overflow-hidden rounded-full border border-rule bg-white text-xs font-bold shadow-sm">
        {(Object.keys(TILES) as TileStyle[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTileStyle(k)}
            aria-pressed={tileStyle === k}
            className={`px-3 py-1 ${tileStyle === k ? "bg-accent text-white" : "text-ink"}`}
          >
            {TILES[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}
