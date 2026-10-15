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
 * - 「夜」は白地図の暗い版（Esri World Dark Gray Base、同じホスト）。駅・区の名前は暗い札で重ねる。
 *   選んだ地図はその端末に覚えておく（既定は白地図）。
 * - PC では見えている部分の左下に、地図の真ん中の緯度経度と拡大の度合いを小さく出す（飾りを兼ねた目安）。
 * - 事業所の点は canvas でまとめて描く（千件でも軽い）。点の色＝サービスの種類。
 *   縁取りは白で統一（2色の縁取りはごちゃつくのでやめた）。
 * - 同じ場所に複数の事業所があるときは、少し大きい点を1つだけ描き、
 *   押したら先頭の事業所を選ぶ（一覧側に「ほかにN件」と出す）。
 * - 点の色や形は画面側（OfficeMapApp）が決めて points で渡す。
 *   「競合の動き」では新しく載った事業所を濃い縁取り、載らなくなった事業所を白抜きの灰色で描く。
 * - 「需要と競合」では、500m 四方のマス（cells）を色で塗って事業所の下に重ねる。
 * - PC では地図を画面いっぱいに敷き、その上にパネルを浮かせる。パネルに隠れる分（insets）を除いた
 *   「見えている部分」に範囲の円や選んだ事業所が収まるように寄せる。
 * - 拡大・縮小・地図の切り替え・範囲全体のボタンは自前（すりガラスの見た目に揃えるため）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { CHIBA_LANDMARKS } from "@/lib/landmarks";
import { meshBounds, meshCodeAt } from "@/lib/mesh";
import type { LatLng } from "@/lib/offices";

type TileStyle = "white" | "pale" | "night";
const TILE_KEY = "care-office-map:tile";

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
  night: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    label: "夜",
    attribution:
      '&copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, &copy; OpenStreetMap',
    maxNativeZoom: 16,
  },
};

/** 地図の種類ごとの線の色（明るい地図には濃い青緑、夜の地図にはネオン） */
const INK: Record<TileStyle, { ring: string; sel: string; selGlow: string; cell: string; newEdge: string }> = {
  white: { ring: "#0f766e", sel: "#0f766e", selGlow: "#14b8a6", cell: "#15211e", newEdge: "#15211e" },
  pale: { ring: "#0f766e", sel: "#0f766e", selGlow: "#14b8a6", cell: "#15211e", newEdge: "#15211e" },
  night: { ring: "#2ef2d0", sel: "#ffffff", selGlow: "#2ef2d0", cell: "#ffffff", newEdge: "#ffffff" },
};

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  /** normal：塗り＋白い縁 / new：塗り＋濃い縁 / gone：白抜きの灰色 / muted：小さな薄い灰色（背景として見せるだけ） */
  style?: "normal" | "new" | "gone" | "muted";
  /** 点の大きさの倍率（体制比較で利用者数に合わせる）。無ければ 1 */
  scale?: number;
};

export type CellOverlay = { code: string; color: string; opacity: number };

/** 地図の上に重なっているパネルの分（px）。そこを除いた部分に寄せる */
export type MapInsets = { top: number; right: number; bottom: number; left: number };
const NO_INSETS: MapInsets = { top: 0, right: 0, bottom: 0, left: 0 };

type Props = {
  center: LatLng & { label: string };
  radiusKm: number;
  points: MapPoint[];
  selectedId: string | null;
  onSelect: (id: string, sameSpot: number) => void;
  /** 500m 四方のマスの色分け（需要と競合） */
  cells?: CellOverlay[];
  /** 選んだマス（枠で囲み、そこへ寄る） */
  focusCell?: { code: string; token: number } | null;
  onCellSelect?: (code: string) => void;
  /** 値が変わるたびに、範囲の円全体が入るように合わせる */
  fitToken: number;
  /** 値が変わるたびに、選んだ事業所へ寄る */
  focus: { lat: number; lng: number; token: number } | null;
  /** 値が変わるたびに、これらの点が全部入るように合わせる（選んだ法人の事業所など） */
  fitPoints?: { points: LatLng[]; token: number } | null;
  /** 地図の上に重なっているパネルの分 */
  insets?: MapInsets;
  /** 外枠の見た目（角の丸めなど） */
  className?: string;
};

const SELF_ICON_HTML =
  '<div class="pin"><i class="pulse"></i><i class="pulse late"></i><svg viewBox="0 0 28 28" aria-hidden="true"><defs><linearGradient id="self-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2ef2d0"></stop><stop offset="0.52" stop-color="#38bdf8"></stop><stop offset="1" stop-color="#8b7bff"></stop></linearGradient></defs><circle cx="14" cy="14" r="12" fill="url(#self-grad)" stroke="#03141a" stroke-width="2"></circle><path d="M8.5 14.5 14 9.5l5.5 5v5.5h-3.6v-3.8h-3.8V20H8.5z" fill="#03141a"></path></svg><span class="tag">自社</span></div>';

/** 拡大・縮小のボタン */
const CTRL = "grid h-9 w-9 place-items-center text-ink transition-colors hover:bg-white/10 hover:text-accent";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function OfficeMap({
  center,
  radiusKm,
  points,
  selectedId,
  onSelect,
  cells,
  focusCell,
  onCellSelect,
  fitToken,
  focus,
  fitPoints,
  insets = NO_INSETS,
  className = "",
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const tileRef = useRef<Leaflet.TileLayer | null>(null);
  const officeLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const landmarkLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const cellLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const cellRendererRef = useRef<Leaflet.Canvas | null>(null);
  const focusCellRef = useRef<Leaflet.Rectangle | null>(null);
  const onCellSelectRef = useRef(onCellSelect);
  const rendererRef = useRef<Leaflet.Canvas | null>(null);
  const circleRef = useRef<Leaflet.Circle | null>(null);
  const selfRef = useRef<Leaflet.Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const insetsRef = useRef(insets);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(14);
  const [tileStyle, setTileStyle] = useState<TileStyle>("white");
  const [view, setView] = useState<{ lat: number; lng: number } | null>(null);
  const ink = INK[tileStyle];

  // 前に選んだ地図の種類（端末に保存。読めなくても白地図で動く）
  useEffect(() => {
    try {
      const v = localStorage.getItem(TILE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 保存値の読み出しは描画後にしかできない
      if (v === "white" || v === "pale" || v === "night") setTileStyle(v);
    } catch {
      // 保存できない端末では毎回白地図
    }
  }, []);
  const chooseTile = (k: TileStyle) => {
    setTileStyle(k);
    try {
      localStorage.setItem(TILE_KEY, k);
    } catch {
      // 保存できなくても切り替えは効く
    }
  };

  useEffect(() => {
    onSelectRef.current = onSelect;
    onCellSelectRef.current = onCellSelect;
    insetsRef.current = insets;
  }, [onSelect, onCellSelect, insets]);

  /** パネルに隠れる分を除いて、bounds が収まるように合わせる */
  const fitVisible = useCallback((b: Leaflet.LatLngBounds, pad: number, maxZoom?: number) => {
    const map = mapRef.current;
    if (!map) return;
    const i = insetsRef.current;
    map.fitBounds(b, { paddingTopLeft: [i.left + pad, i.top + pad], paddingBottomRight: [i.right + pad, i.bottom + pad], maxZoom });
  }, []);

  /** パネルに隠れる分を除いた部分の真ん中へ飛ぶ */
  const flyVisible = useCallback((lat: number, lng: number, zoom: number) => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    const i = insetsRef.current;
    const p = map.project([lat, lng], zoom).subtract(L.point((i.left - i.right) / 2, (i.top - i.bottom) / 2));
    map.flyTo(map.unproject(p, zoom), zoom, { duration: 0.6 });
  }, []);

  const fitCircle = useCallback(() => {
    if (circleRef.current) fitVisible(circleRef.current.getBounds(), 12);
  }, [fitVisible]);

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
      L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
      // マスの色分けは事業所の点より下に描く（専用の層）
      map.createPane("cells").style.zIndex = "350";
      cellRendererRef.current = L.canvas({ padding: 0.3, pane: "cells" });
      cellLayerRef.current = L.layerGroup().addTo(map);
      rendererRef.current = L.canvas({ padding: 0.3, tolerance: 6 });
      circleRef.current = L.circle([center.lat, center.lng], {
        radius: radiusKm * 1000,
        color: "#1d5d66",
        weight: 1.5,
        opacity: 0.7,
        dashArray: "5 6",
        fill: false,
        interactive: false,
        className: "radius-ring",
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
      // 真ん中の緯度経度（PC の左下の表示用）。動かしている間は1コマに1回だけ
      let raf = 0;
      const syncView = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const c = map.getCenter();
          setView({ lat: c.lat, lng: c.lng });
        });
      };
      map.on("move", syncView);
      // マスは点の下の別の層にあって直接は押せないので、地図を押した位置からマスの番号を出す
      map.on("click", (e: Leaflet.LeafletMouseEvent) => onCellSelectRef.current?.(meshCodeAt(e.latlng.lat, e.latlng.lng)));
      mapRef.current = map;
      fitCircle();
      setZoom(map.getZoom());
      syncView();
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
    if (tileStyle === "pale") return;
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

  // 範囲の円の色（地図の種類に合わせる）
  useEffect(() => {
    if (ready) circleRef.current?.setStyle({ color: ink.ring, opacity: tileStyle === "night" ? 0.9 : 0.7 });
  }, [ready, ink.ring, tileStyle]);

  // 中心・半径
  useEffect(() => {
    if (!ready) return;
    circleRef.current?.setLatLng([center.lat, center.lng]).setRadius(radiusKm * 1000);
    selfRef.current?.setLatLng([center.lat, center.lng]);
  }, [ready, center.lat, center.lng, radiusKm]);

  // 範囲全体に合わせる
  useEffect(() => {
    if (ready) fitCircle();
  }, [ready, fitToken, fitCircle]);

  // 指定の点が全部入るように合わせる
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || !fitPoints || !fitPoints.points.length) return;
    const b = L.latLngBounds(fitPoints.points.map((p) => [p.lat, p.lng] as [number, number]));
    fitVisible(b.extend([center.lat, center.lng]), 28, 15);
    // 中心は合わせ直しのときだけ使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitPoints, fitVisible]);

  // 選んだ事業所へ寄る
  useEffect(() => {
    if (!ready || !focus || !mapRef.current) return;
    const map = mapRef.current;
    flyVisible(focus.lat, focus.lng, Math.max(map.getZoom(), 15));
  }, [ready, focus, flyVisible]);

  // マスの色分け
  useEffect(() => {
    const L = LRef.current;
    const layer = cellLayerRef.current;
    const renderer = cellRendererRef.current;
    if (!ready || !L || !layer || !renderer) return;
    layer.clearLayers();
    for (const c of cells ?? []) {
      const b = meshBounds(c.code);
      const r = L.rectangle(
        [
          [b.south, b.west],
          [b.north, b.east],
        ],
        { renderer, pane: "cells", stroke: false, fillColor: c.color, fillOpacity: c.opacity, interactive: false },
      );
      r.addTo(layer);
    }
  }, [ready, cells]);

  // 選んだマスを枠で囲んで寄る
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    focusCellRef.current?.remove();
    focusCellRef.current = null;
    if (!focusCell) return;
    const b = meshBounds(focusCell.code);
    const bounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);
    focusCellRef.current = L.rectangle(bounds, { color: ink.cell, weight: 2.5, fill: false, interactive: false }).addTo(map);
    const c = bounds.getCenter();
    flyVisible(c.lat, c.lng, Math.max(map.getZoom(), 14));
    // 地図の種類を替えたときに飛び直さないよう、色は作ったときのものを使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusCell, flyVisible]);

  // 事業所の点
  useEffect(() => {
    const L = LRef.current;
    const layer = officeLayerRef.current;
    const renderer = rendererRef.current;
    if (!ready || !L || !layer || !renderer) return;
    layer.clearLayers();
    const r = zoom < 12.5 ? 4 : zoom < 14 ? 5.5 : 7;
    const groups = new Map<string, MapPoint[]>();
    for (const p of points) {
      const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
      const g = groups.get(key) ?? [];
      g.push(p);
      groups.set(key, g);
    }
    let selected: MapPoint | null = null;
    // 薄い灰色・載らなくなった（白抜き）を先に描き、塗りの点を上に重ねる
    // 大きい点を先に描き、小さい点が隠れないようにする
    const back = (g: MapPoint[]) => (g[0].style === "muted" ? 2 : g[0].style === "gone" ? 1 : 0);
    const ordered = [...groups.values()].sort((a, b) => back(b) - back(a) || (b[0].scale ?? 1) - (a[0].scale ?? 1));
    for (const g of ordered) {
      const p = g[0];
      const size = r * (p.scale ?? 1) + (g.length > 1 ? 1 : 0);
      const opts: Leaflet.CircleMarkerOptions =
        p.style === "muted"
          ? { renderer, radius: Math.max(3, size - 1.5), fillColor: "#a3aca6", fillOpacity: 0.85, color: "#ffffff", weight: 1 }
          : p.style === "gone"
          ? { renderer, radius: size, fillColor: "#ffffff", fillOpacity: 1, color: "#7a837f", weight: 2, dashArray: "3 2" }
          : p.style === "new"
            ? { renderer, radius: size + 1, fillColor: p.color, fillOpacity: 0.95, color: ink.newEdge, weight: 2.5 }
            : { renderer, radius: size, fillColor: p.color, fillOpacity: 0.9, color: "#ffffff", weight: 1.5 };
      // 点を押したときに地図の click（マスの選択）まで届かないようにする
      const m = L.circleMarker([p.lat, p.lng], { ...opts, bubblingMouseEvents: false });
      m.on("click", () => onSelectRef.current(p.id, g.length));
      m.addTo(layer);
      const hit = g.find((x) => x.id === selectedId);
      if (hit) selected = hit;
    }
    if (selected) {
      L.circleMarker([selected.lat, selected.lng], {
        renderer,
        radius: r * ((selected as MapPoint).scale ?? 1) + 8,
        weight: 5,
        fill: false,
        color: ink.selGlow,
        opacity: 0.4,
        interactive: false,
      }).addTo(layer);
      L.circleMarker([selected.lat, selected.lng], {
        renderer,
        radius: r * ((selected as MapPoint).scale ?? 1) + 4,
        weight: 2.5,
        fill: false,
        color: ink.sel,
        interactive: false,
      }).addTo(layer);
    }
  }, [ready, points, selectedId, zoom, ink]);

  return (
    <div className={`relative isolate h-full w-full overflow-hidden ${tileStyle === "night" ? "map-night" : "map-white"} ${className}`}>
      <div ref={boxRef} className="absolute inset-0" aria-label="事業所の地図" />
      {/* スマホ：地図の四隅に HUD の括弧 */}
      <div className="hud-corners z-[700] lg:hidden" aria-hidden="true" />
      {/* PC：見えている部分の左下に、真ん中の緯度経度と拡大の度合い */}
      {view && (
        <div
          className="glass pointer-events-none absolute bottom-4 z-[800] hidden items-center gap-2 rounded-full px-3 py-1 font-mono text-[10.5px] tabular-nums tracking-wider text-muted lg:flex"
          style={{ left: insets.left + 16 }}
          aria-hidden="true"
        >
          <span className="live-dot" />
          <span className="text-accent">{view.lat.toFixed(4)}°N</span>
          <span>{view.lng.toFixed(4)}°E</span>
          <span className="text-ink/40">|</span>
          <span>Z{zoom.toFixed(1)}</span>
        </div>
      )}
      {/* スマホ：左上に地図の切り替え・右上に拡大縮小・左下に範囲全体。PC：右下にまとめる（左と上はパネルが重なるため） */}
      <div className="glass absolute left-3 top-3 z-[800] flex rounded-full p-0.5 text-xs font-bold lg:bottom-[10.25rem] lg:left-auto lg:right-4 lg:top-auto">
        {(Object.keys(TILES) as TileStyle[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => chooseTile(k)}
            aria-pressed={tileStyle === k}
            className={`rounded-full px-3 py-1 transition-colors ${tileStyle === k ? "bg-grad" : "text-ink hover:bg-white/10"}`}
          >
            {TILES[k].label}
          </button>
        ))}
      </div>
      <div className="glass absolute right-3 top-3 z-[800] flex flex-col overflow-hidden rounded-xl lg:bottom-9 lg:right-4 lg:top-auto">
        <button type="button" title="拡大" aria-label="拡大" onClick={() => mapRef.current?.zoomIn()} className={CTRL}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <span className="mx-2 h-px bg-ink/10" aria-hidden="true" />
        <button type="button" title="縮小" aria-label="縮小" onClick={() => mapRef.current?.zoomOut()} className={CTRL}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>
      {ready && (
        <button
          type="button"
          onClick={fitCircle}
          className="glass absolute bottom-3 left-3 z-[800] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:text-accent lg:bottom-[7.25rem] lg:left-auto lg:right-4"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
          </svg>
          範囲全体を見る
        </button>
      )}
    </div>
  );
}
