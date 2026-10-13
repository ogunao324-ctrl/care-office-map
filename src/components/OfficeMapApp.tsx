"use client";

/**
 * 画面全体
 *
 * 3つの見方を上のタブで切り替える。地図は共通で、見方ごとに描くものが変わる。
 *  - 事業所をさがす：検索・絞り込み → 地図 → 自社から近い順の一覧
 *  - 需要と競合　　：500m 四方のマスを「事業所の足りなさ」か「人数」で色分けし、足りない町を並べる
 *  - 競合の動き　　：期間内に新しく載った／載らなくなった事業所と、数の推移
 *
 * スマホ：上に操作、その下に地図、残りが一覧などの中身。PC（幅1024px〜）：左に中身、右に地図。
 *
 * データ（どれも GitHub Actions が作って public/data/ に置く）
 *  - offices.json … 今の事業所（scripts/update-data.ts）
 *  - areas.json   … 国勢調査の人口（scripts/update-population.ts）。「需要と競合」を開いたときに読む
 *  - history.json … 過去の公表データ（scripts/update-history.ts）。お知らせに使うので最初に裏で読む
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ALERT_CATEGORIES, ALERT_RADIUS_KM, DEFAULT_RADIUS, GAP_RADIUS_KM, MAX_KM, RADII } from "@/config";
import {
  computeGap,
  COUNT_COLORS,
  countBreaks,
  DEMAND_LABEL,
  shortageRanking,
  shortageStep,
  type AreaData,
  type DemandBase,
} from "@/lib/areas";
import { periodChanges, ymLabel, type Change, type HistoryData } from "@/lib/history";
import { meshCodeAt } from "@/lib/mesh";
import { CATEGORIES, categoryColor, categoryRecord, digitsOnly, distanceKm, type CategoryId, type OfficeData } from "@/lib/offices";
import { searchKey } from "@/lib/search-text";
import { GapPanel, type ColorMode } from "./GapPanel";
import type { CellOverlay, MapPoint } from "./OfficeMap";
import { AboutData, OfficeRow, type Row } from "./OfficeList";
import { TrendPanel } from "./TrendPanel";
import { Note, PickChips } from "./ui";

const OfficeMap = dynamic(() => import("./OfficeMap").then((m) => m.OfficeMap), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-xl border border-rule bg-[#e9ece6]" />,
});

const PAGE = 150;
const RADIUS_KEY = "care-office-map:radius";
const ALL_ON: Record<CategoryId, boolean> = categoryRecord(true);

type Mode = "list" | "gap" | "trend";
const MODES: { id: Mode; label: string }[] = [
  { id: "list", label: "事業所をさがす" },
  { id: "gap", label: "需要と競合" },
  { id: "trend", label: "競合の動き" },
];

const PERIODS = [
  { value: 6, label: "半年" },
  { value: 12, label: "1年" },
  { value: 36, label: "3年" },
  { value: 600, label: "全期間" },
];

const GAP_CATEGORIES = CATEGORIES.filter((c) => c.id !== "ot");

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export function OfficeMapApp() {
  const [data, setData] = useState<OfficeData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("list");

  // 事業所をさがす
  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<Record<CategoryId, boolean>>(ALL_ON);
  const [radius, setRadius] = useState<number>(DEFAULT_RADIUS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const [sameSpot, setSameSpot] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [fitToken, setFitToken] = useState(0);
  const [focus, setFocus] = useState<{ lat: number; lng: number; token: number } | null>(null);

  // 需要と競合
  const [areas, setAreas] = useState<AreaData | null>(null);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [gapCat, setGapCat] = useState<CategoryId>("hh");
  const [base, setBase] = useState<DemandBase>("p75");
  const [colorMode, setColorMode] = useState<ColorMode>("short");
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [focusCell, setFocusCell] = useState<{ code: string; token: number } | null>(null);

  // 競合の動き
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [months, setMonths] = useState(12);
  const [selectedChange, setSelectedChange] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getJson<OfficeData>("/data/offices.json")
      .then((d) => {
        if (!alive) return;
        // 前回選んだ距離（端末ごと）。データと同時に反映して、地図の合わせ直しを1回で済ませる
        try {
          const saved = Number(localStorage.getItem(RADIUS_KEY));
          if ((RADII as readonly number[]).includes(saved)) setRadius(saved);
        } catch {
          // 保存できない端末では毎回の初期値で開く
        }
        setData(d);
        // 近くの新規開設のお知らせに使うので、過去のデータも続けて読んでおく
        getJson<HistoryData>("/data/history.json")
          .then((h) => alive && setHistory(h))
          .catch((e) => alive && setHistoryError(String(e)));
      })
      .catch((e) => alive && setLoadError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  // 見方を切り替えたら、範囲の円全体が入るように地図を合わせ直す
  const changeMode = (m: Mode) => {
    setMode(m);
    setFitToken((t) => t + 1);
  };

  // 人口は「需要と競合」を初めて開いたときに読む
  useEffect(() => {
    if (mode !== "gap" || areas || areasError) return;
    let alive = true;
    getJson<AreaData>("/data/areas.json")
      .then((a) => alive && setAreas(a))
      .catch((e) => alive && setAreasError(String(e)));
    return () => {
      alive = false;
    };
  }, [mode, areas, areasError]);

  const center = data?.center ?? null;

  // ---------- 事業所をさがす ----------
  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    return data.offices.map((o) => ({
      ...o,
      distance: o.lat != null && o.lng != null ? distanceKm(data.center, { lat: o.lat, lng: o.lng }) : null,
      key: `${searchKey([o.name, o.kana, o.corp, o.address].filter(Boolean).join(" "))} ${digitsOnly(o.tel)} ${digitsOnly(o.fax)}`,
    }));
  }, [data]);

  const { visible, counts } = useMemo(() => {
    const q = searchKey(query.trim()).replace(/\s/g, "");
    const qDigits = digitsOnly(query);
    const counts: Record<CategoryId, number> = categoryRecord(0);
    const visible: Row[] = [];
    for (const o of rows) {
      const inRange = o.distance != null ? o.distance <= radius + 1e-9 : true;
      if (!inRange) continue;
      if (q && !o.key.replace(/\s/g, "").includes(q) && !(qDigits.length >= 3 && o.key.includes(qDigits))) continue;
      let on = false;
      for (const c of o.categories) {
        counts[c]++;
        if (cats[c]) on = true;
      }
      if (on) visible.push(o);
    }
    visible.sort((a, b) => {
      if (!!a.self !== !!b.self) return a.self ? -1 : 1;
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });
    return { visible, counts };
  }, [rows, query, cats, radius]);

  const select = useCallback(
    (id: string, spot = 0, fromMap = false) => {
      setSelectedId((cur) => (cur === id && !fromMap ? null : id));
      setSameSpot(spot);
      const o = rows.find((x) => x.id === id);
      if (!o) return;
      const idx = visible.findIndex((x) => x.id === id);
      if (idx >= shown) setShown(Math.ceil((idx + 1) / PAGE) * PAGE);
      if (fromMap) {
        requestAnimationFrame(() =>
          document.getElementById(`row-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
        );
      } else if (o.lat != null && o.lng != null) {
        setFocus({ lat: o.lat, lng: o.lng, token: Date.now() });
      }
    },
    [rows, visible, shown],
  );

  // 「競合の動き」から事業所の詳細へ移ったとき、一覧に出てから選ぶ
  useEffect(() => {
    if (mode !== "list" || !pendingSelect) return;
    if (!visible.some((o) => o.id === pendingSelect)) return;
    const id = pendingSelect;
    const t = setTimeout(() => {
      setPendingSelect(null);
      select(id);
      requestAnimationFrame(() => document.getElementById(`row-${id}`)?.scrollIntoView({ block: "start" }));
    }, 0);
    return () => clearTimeout(t);
  }, [mode, pendingSelect, visible, select]);

  const changeRadius = (r: number) => {
    setRadius(r);
    setShown(PAGE);
    setFitToken((t) => t + 1);
    try {
      localStorage.setItem(RADIUS_KEY, String(r));
    } catch {
      // 保存できなくても動作には影響しない
    }
  };

  // ---------- 需要と競合 ----------
  const gap = useMemo(() => {
    if (mode !== "gap" || !areas || !data) return null;
    return computeGap(areas.cells, data.offices, { center: data.center, category: gapCat, base, radiusKm: GAP_RADIUS_KM, maxKm: MAX_KM });
  }, [mode, areas, data, gapCat, base]);

  const ranking = useMemo(() => (gap ? shortageRanking(gap.cells.filter((g) => g.distance <= radius), base, 10) : []), [gap, radius, base]);
  const selfCell = useMemo(() => {
    if (!gap || !center) return null;
    const code = meshCodeAt(center.lat, center.lng);
    return gap.cells.find((g) => g.c === code) ?? null;
  }, [gap, center]);
  const selectedCellObj = useMemo(() => gap?.cells.find((g) => g.c === selectedCell) ?? null, [gap, selectedCell]);
  const breaks = useMemo(() => (gap ? countBreaks(gap.cells.map((g) => g[base])) : [1, 2, 3, 4]), [gap, base]);

  const cellOverlay: CellOverlay[] | undefined = useMemo(() => {
    if (mode !== "gap" || !gap) return undefined;
    const out: CellOverlay[] = [];
    for (const g of gap.cells) {
      if (colorMode === "short") {
        const s = shortageStep(g.index);
        if (!s || s.label === "ふつう") continue;
        out.push({ code: g.c, color: s.color, opacity: s.opacity });
      } else {
        const v = g[base];
        if (v <= 0) continue;
        const i = breaks.findIndex((b) => v <= b);
        out.push({ code: g.c, color: COUNT_COLORS[i < 0 ? COUNT_COLORS.length - 1 : i], opacity: 0.6 });
      }
    }
    return out;
  }, [mode, gap, colorMode, base, breaks]);

  const pickCell = useCallback(
    (code: string, fly: boolean) => {
      if (!gap?.cells.some((g) => g.c === code)) {
        setSelectedCell(null);
        return;
      }
      setSelectedCell(code);
      if (fly) setFocusCell({ code, token: Date.now() });
    },
    [gap],
  );

  // ---------- 競合の動き ----------
  const changes = useMemo(() => {
    if (!history || !center) return [];
    return periodChanges(history, center, radius, months).filter((c) => c.categories.some((k) => cats[k]));
  }, [history, center, radius, months, cats]);

  /** 自社と同じサービスで、直近の時点に近くで新しく載った事業所（お知らせ） */
  const alerts = useMemo(() => {
    if (!history || !center) return [];
    return periodChanges(history, center, ALERT_RADIUS_KM, 6).filter(
      (c) => c.kind === "open" && c.categories.some((k) => (ALERT_CATEGORIES as readonly string[]).includes(k)),
    );
  }, [history, center]);

  const officeOfChange = useCallback(
    (c: Change) => data?.offices.find((o) => o.numbers.some((n) => digitsOnly(n) === c.no)) ?? null,
    [data],
  );

  const openOfficeFromChange = (c: Change) => {
    const o = officeOfChange(c);
    if (!o) return;
    const d = o.lat != null && o.lng != null && center ? distanceKm(center, { lat: o.lat, lng: o.lng }) : 0;
    const r = RADII.find((x) => x >= d) ?? RADII[RADII.length - 1];
    if (r > radius) changeRadius(r);
    setQuery("");
    setCats((s) => {
      const next = { ...s };
      for (const k of o.categories) next[k] = true;
      return next;
    });
    changeMode("list");
    setPendingSelect(o.id);
  };

  const showAlerts = () => {
    setCats(() => {
      const next = categoryRecord(false);
      for (const k of ALERT_CATEGORIES) next[k] = true;
      return next;
    });
    setMonths(6);
    changeRadius(ALERT_RADIUS_KM);
    setSelectedChange(null);
    changeMode("trend");
  };

  // ---------- 地図に描くもの ----------
  const points: MapPoint[] = useMemo(() => {
    if (!data) return [];
    if (mode === "gap") {
      return data.offices
        .filter((o) => o.lat != null && o.lng != null && !o.self && o.categories.includes(gapCat))
        .map((o) => ({ id: o.id, lat: o.lat as number, lng: o.lng as number, color: "#334155" }));
    }
    if (mode === "trend") {
      return changes
        .filter((c) => c.lat != null && c.lng != null)
        .map((c) => ({
          id: c.key,
          lat: c.lat as number,
          lng: c.lng as number,
          color: categoryColor(c.categories.find((k) => cats[k]) ?? c.categories[0]),
          style: c.kind === "closed" || c.kind === "dropped" ? ("gone" as const) : ("new" as const),
        }));
    }
    return visible
      .filter((o) => o.lat != null && o.lng != null && !o.self)
      .map((o) => ({
        id: o.id,
        lat: o.lat as number,
        lng: o.lng as number,
        // 絞り込みで表示中の種類のうち、いちばん先のものの色で塗る
        color: categoryColor(o.categories.find((c) => cats[c]) ?? o.categories[0]),
      }));
  }, [data, mode, gapCat, changes, visible, cats]);

  const onMapSelect = useCallback(
    (id: string, spot: number) => {
      if (mode === "list") select(id, spot, true);
      else if (mode === "trend") {
        setSelectedChange(id);
        requestAnimationFrame(() =>
          document.getElementById(`chg-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
        );
      } else {
        const o = data?.offices.find((x) => x.id === id);
        if (o?.lat != null && o.lng != null) pickCell(meshCodeAt(o.lat, o.lng), false);
      }
    },
    [mode, select, data, pickCell],
  );

  const onCellSelect = useCallback((code: string) => pickCell(code, false), [pickCell]);

  const hasData = (data?.offices.length ?? 0) > 0;
  const gapCatName = CATEGORIES.find((c) => c.id === gapCat)?.name ?? "";

  const subline =
    mode === "list"
      ? `自社から${radius}km以内${data ? `・${visible.length.toLocaleString("ja-JP")}件` : ""}`
      : mode === "gap"
        ? `${gapCatName}が${DEMAND_LABEL[base]}の人数に対して足りている場所・足りない場所`
        : `自社から${radius}km以内で新しく載った／載らなくなった事業所`;

  const radiusChips = (
    <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="自社からの距離">
      <span className="shrink-0 pr-0.5 text-xs text-muted">距離</span>
      {RADII.map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={radius === r}
          onClick={() => changeRadius(r)}
          className={`shrink-0 rounded-full border px-3 py-1 text-[13px] tabular-nums ${radius === r ? "border-accent bg-accent text-white" : "border-rule bg-white"}`}
        >
          {r}km
        </button>
      ))}
    </div>
  );

  const categoryChips = (withCounts: boolean) => (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="サービスの種類">
      {CATEGORIES.filter((c) => c.id !== "ot" || counts.ot > 0).map((c) => {
        const on = cats[c.id];
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => {
              setCats((s) => ({ ...s, [c.id]: !s[c.id] }));
              setShown(PAGE);
            }}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-rule bg-white px-3 py-1 text-[13px] ${on ? "" : "opacity-55"}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={on ? { background: c.color } : { boxShadow: `inset 0 0 0 2px ${c.color}` }} />
            {c.name}
            {withCounts && <span className="text-[11px] tabular-nums text-muted">{counts[c.id]}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-2.5 px-4 pt-2.5 lg:pt-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-wide">花見川 事業所マップ</h1>
          <p className="truncate text-xs text-muted">{subline}</p>
        </div>
        {mode === "list" && (
          <a href="#about-data" className="shrink-0 rounded-full border border-rule bg-white px-3 py-1.5 text-xs font-bold text-ink">
            データについて
          </a>
        )}
      </header>

      <nav className="grid grid-cols-3 rounded-lg border border-rule bg-white p-0.5 text-[13px] font-bold lg:max-w-md" aria-label="見方">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => changeMode(m.id)}
            className={`rounded-md px-2 py-1.5 ${mode === m.id ? "bg-ink text-white" : "text-ink"}`}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        {mode === "list" && (
          <>
            <label className="flex items-center gap-2 rounded-lg border border-rule bg-white px-3 lg:min-w-[320px] lg:flex-1">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                autoComplete="off"
                enterKeyHint="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShown(PAGE);
                }}
                placeholder="事業所名・法人名・住所・電話番号"
                aria-label="事業所を検索"
                className="has-custom-clear min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className="shrink-0 text-sm text-muted" aria-label="検索語を消す">
                  ×
                </button>
              )}
            </label>
            {categoryChips(true)}
            {radiusChips}
          </>
        )}
        {mode === "gap" && (
          <>
            <PickChips
              label="比べる"
              options={GAP_CATEGORIES.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
              value={gapCat}
              onChange={(v) => {
                setGapCat(v);
                // 障害のサービスは高齢者ではなく総人口で見るのが自然なので、切り替えたときに寄せる
                if ((v === "dv" || v === "cs") && base !== "pop") setBase("pop");
                if (v !== "dv" && v !== "cs" && base === "pop") setBase("p75");
              }}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <PickChips
                label="人数"
                options={(["p75", "p65", "pop"] as DemandBase[]).map((b) => ({ value: b, label: DEMAND_LABEL[b] }))}
                value={base}
                onChange={setBase}
              />
              <PickChips
                label="色"
                options={[
                  { value: "short" as ColorMode, label: "足りなさ" },
                  { value: "count" as ColorMode, label: "人数" },
                ]}
                value={colorMode}
                onChange={setColorMode}
              />
            </div>
            {radiusChips}
          </>
        )}
        {mode === "trend" && (
          <>
            {categoryChips(false)}
            <PickChips label="期間" options={PERIODS} value={months} onChange={setMonths} />
            {radiusChips}
          </>
        )}
      </div>

      {mode === "list" && alerts.length > 0 && (
        <button
          type="button"
          onClick={showAlerts}
          className="flex items-center justify-between gap-2 rounded-lg border border-ink bg-white px-3 py-2 text-left text-[13px]"
        >
          <span className="min-w-0">
            <b>{ALERT_RADIUS_KM}km以内に新しい訪問介護・障害の訪問系が{alerts.length}件</b>
            <span className="text-muted">（{ymLabel(alerts[0].to)}までの半年の公表）</span>
          </span>
          <span className="shrink-0 text-xs font-bold text-accent">見る</span>
        </button>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-2.5 lg:flex-row">
        <div className="relative h-[42%] min-h-56 shrink-0 lg:order-2 lg:h-auto lg:flex-1">
          {center ? (
            <OfficeMap
              center={center}
              radiusKm={radius}
              points={points}
              selectedId={mode === "trend" ? selectedChange : mode === "list" ? selectedId : null}
              onSelect={onMapSelect}
              cells={cellOverlay}
              focusCell={mode === "gap" ? focusCell : null}
              onCellSelect={mode === "gap" ? onCellSelect : undefined}
              fitToken={fitToken}
              focus={focus}
            />
          ) : (
            <div className="h-full w-full rounded-xl border border-rule bg-[#e9ece6]" />
          )}
          {center && (
            <button
              type="button"
              onClick={() => setFitToken((t) => t + 1)}
              className="absolute bottom-2 left-2 z-[800] rounded-full border border-rule bg-white px-3 py-1 text-xs font-bold shadow-sm"
            >
              範囲全体を見る
            </button>
          )}
        </div>

        <section className="min-h-0 flex-1 overflow-y-auto pb-4 lg:order-1 lg:w-[400px] lg:flex-none" aria-label={MODES.find((m) => m.id === mode)?.label}>
          {mode === "gap" && (
            <GapPanel
              gap={gap}
              error={areasError}
              category={gapCat}
              base={base}
              colorMode={colorMode}
              radiusKm={radius}
              ranking={ranking}
              selfCell={selfCell}
              selectedCell={selectedCellObj}
              breaks={breaks}
              onPickCell={(code) => pickCell(code, true)}
            />
          )}

          {mode === "trend" && (
            <TrendPanel
              history={history}
              error={historyError}
              center={center}
              radiusKm={radius}
              cats={cats}
              months={months}
              changes={changes}
              selectedKey={selectedChange}
              onSelect={(key) => {
                setSelectedChange((cur) => (cur === key ? null : key));
                const c = changes.find((x) => x.key === key);
                if (c?.lat != null && c.lng != null) setFocus({ lat: c.lat, lng: c.lng, token: Date.now() });
              }}
              hasCurrent={(c) => !!officeOfChange(c)}
              onOpenOffice={openOfficeFromChange}
            />
          )}

          {mode === "list" && (
            <>
              <div className="sticky top-0 z-10 flex items-baseline justify-between bg-paper px-0.5 pb-1.5 text-xs text-muted">
                <span>
                  <b className="text-[15px] tabular-nums text-ink">{visible.length.toLocaleString("ja-JP")}</b> 件
                </span>
                <span>自社から近い順</span>
              </div>

              {!data && !loadError && <Note>事業所データを読み込んでいます…</Note>}
              {loadError && <Note title="事業所データを読み込めませんでした">通信状態を確認して、開き直してください。（{loadError}）</Note>}
              {data && !hasData && (
                <Note title="事業所データはまだ入っていません">
                  GitHub の Actions にある「事業所データの更新」を実行すると、厚生労働省と WAM NET の公表データを取り込んでここに並びます。
                </Note>
              )}
              {hasData && visible.length === 0 && (
                <Note title="条件に合う事業所がありません">距離を広げるか、サービスの絞り込みや検索語を見直してください。</Note>
              )}

              <ol className="flex flex-col gap-1.5">
                {visible.slice(0, shown).map((o) => (
                  <OfficeRow
                    key={o.id}
                    office={o}
                    open={o.id === selectedId}
                    sameSpot={o.id === selectedId ? sameSpot : 0}
                    center={center}
                    forms={data?.kaigoDetailForms}
                    onToggle={() => select(o.id)}
                  />
                ))}
              </ol>
              {visible.length > shown && (
                <button
                  type="button"
                  onClick={() => setShown((s) => s + PAGE)}
                  className="mt-2 w-full rounded-lg border border-dashed border-rule py-2.5 text-sm text-muted"
                >
                  さらに表示（残り {(visible.length - shown).toLocaleString("ja-JP")} 件）
                </button>
              )}

              {data && (
                <AboutData
                  data={data}
                  extra={
                    <p className="text-[11px] leading-relaxed text-muted">
                      「需要と競合」の人口：総務省統計局「令和2年国勢調査」250mメッシュ・小地域境界（e-Stat）を加工。
                      「競合の動き」：厚生労働省（2021年6月末〜）・WAM NET（2021年11月末〜）の過去の公表データを加工。
                    </p>
                  }
                />
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
