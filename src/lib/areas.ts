/**
 * 需要と競合（空白地帯さがし）
 *
 * 人口は国勢調査（2020年）の 250m メッシュを 500m 四方にまとめたもの（public/data/areas.json）。
 * マスごとに「そのマスの中心から半径 R km の範囲」で
 *   需要 = 範囲内のマスの人口（75歳以上・65歳以上・総人口のどれか）の合計
 *   供給 = 範囲内にある、選んだ種類の事業所の数
 * を数え、需要 1,000 人あたりの事業所数（充足度）を出す。
 * 充足度を、収録範囲全体の平均（範囲内の事業所数 ÷ 範囲内の需要）と比べて「足りない／多い」を決める。
 */

import { meshCenter } from "./mesh";
import type { CategoryId, LatLng, Office } from "./offices";

export type AreaCell = {
  /** 500m メッシュ番号（9桁） */
  c: string;
  /** そのマスの中心が入っている町丁目（例：花見川区検見川町3丁目）。海などは空 */
  n?: string;
  /** 総人口・65歳以上・75歳以上 */
  pop: number;
  p65: number;
  p75: number;
};

export type AreaData = {
  generatedAt: string;
  source: string;
  cells: AreaCell[];
};

export type DemandBase = "p75" | "p65" | "pop";

export const DEMAND_LABEL: Record<DemandBase, string> = {
  p75: "75歳以上",
  p65: "65歳以上",
  pop: "総人口",
};

/** 需要がこれより少ないマスは「判定しない」（畑・工場地帯などで比が暴れるのを防ぐ） */
export const MIN_DEMAND: Record<DemandBase, number> = { p75: 300, p65: 600, pop: 3000 };

export type GapCell = AreaCell & {
  center: LatLng;
  /** 自社からの距離 km */
  distance: number;
  demand: number;
  supply: number;
  /** 需要 1,000 人あたりの事業所数。需要が少なすぎるマスは null */
  ratio: number | null;
  /** 収録範囲全体の平均に対する倍率（0.5 = 平均の半分しかない）。null は判定しない */
  index: number | null;
};

const KM_PER_LAT = 110.57;

function fastKm(a: LatLng, b: LatLng, kmPerLng: number): number {
  const dy = (a.lat - b.lat) * KM_PER_LAT;
  const dx = (a.lng - b.lng) * kmPerLng;
  return Math.sqrt(dx * dx + dy * dy);
}

export type GapResult = {
  cells: GapCell[];
  /** 収録範囲全体の、需要 1,000 人あたりの事業所数 */
  average: number;
  totalDemand: number;
  totalSupply: number;
};

export function computeGap(
  cells: AreaCell[],
  offices: Pick<Office, "lat" | "lng" | "categories">[],
  opts: { center: LatLng; category: CategoryId; base: DemandBase; radiusKm: number; maxKm: number },
): GapResult {
  const kmPerLng = 111.32 * Math.cos((opts.center.lat * Math.PI) / 180);
  const pts = cells.map((c) => ({ cell: c, center: meshCenter(c.c) }));
  const sup = offices.filter((o) => o.lat != null && o.lng != null && o.categories.includes(opts.category)) as {
    lat: number;
    lng: number;
  }[];
  const R = opts.radiusKm;
  const out: GapCell[] = [];
  for (const p of pts) {
    const distance = fastKm(p.center, opts.center, kmPerLng);
    if (distance > opts.maxKm) continue;
    let demand = 0;
    for (const q of pts) {
      if (Math.abs(q.center.lat - p.center.lat) * KM_PER_LAT > R) continue;
      if (fastKm(p.center, q.center, kmPerLng) <= R) demand += q.cell[opts.base];
    }
    let supply = 0;
    for (const o of sup) {
      if (Math.abs(o.lat - p.center.lat) * KM_PER_LAT > R) continue;
      if (fastKm(p.center, o, kmPerLng) <= R) supply++;
    }
    const ratio = demand >= MIN_DEMAND[opts.base] ? (supply / demand) * 1000 : null;
    out.push({ ...p.cell, center: p.center, distance, demand, supply, ratio, index: null });
  }
  const totalDemand = out.reduce((s, g) => s + g[opts.base], 0);
  const totalSupply = sup.filter((o) => fastKm(o, opts.center, kmPerLng) <= opts.maxKm).length;
  const average = totalDemand > 0 ? (totalSupply / totalDemand) * 1000 : 0;
  for (const g of out) g.index = g.ratio != null && average > 0 ? g.ratio / average : null;
  return { cells: out, average, totalDemand, totalSupply };
}

/**
 * 事業所が足りない町のランキング。
 * 判定できるマスのうち、そのマス自体にも人が住んでいる（基準人口が minOwn 以上）ものを
 * 充足度の低い順に並べ、同じ町名は一番足りないマスだけ残す。
 */
export function shortageRanking(gap: GapCell[], base: DemandBase, limit = 10): GapCell[] {
  const minOwn = base === "pop" ? 300 : base === "p65" ? 80 : 40;
  const seen = new Set<string>();
  const out: GapCell[] = [];
  const sorted = gap
    .filter((g) => g.index != null && g[base] >= minOwn && g.index < 1)
    .sort((a, b) => (a.ratio as number) - (b.ratio as number) || b.demand - a.demand);
  for (const g of sorted) {
    const key = g.n || g.c;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
    if (out.length >= limit) break;
  }
  return out;
}

/** 足りなさの段階（地図の色と凡例） */
export const SHORTAGE_STEPS: { max: number; label: string; color: string; opacity: number }[] = [
  { max: 0.5, label: "とても少ない（平均の半分以下）", color: "#c2410c", opacity: 0.55 },
  { max: 0.8, label: "少ない", color: "#f59e0b", opacity: 0.42 },
  { max: 1.25, label: "ふつう", color: "#94a3b8", opacity: 0.1 },
  { max: Infinity, label: "多い", color: "#0f766e", opacity: 0.22 },
];

export function shortageStep(index: number | null) {
  if (index == null) return null;
  return SHORTAGE_STEPS.find((s) => index <= s.max) ?? SHORTAGE_STEPS[SHORTAGE_STEPS.length - 1];
}

/** 人数の色分け（5段階、同じ色の濃淡） */
export const COUNT_COLORS = ["#e0f2f1", "#a7d8d2", "#6bb8b0", "#2f8f87", "#0f5f59"];

export function countBreaks(values: number[]): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [1, 2, 3, 4];
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
  return [q(0.2), q(0.4), q(0.6), q(0.8)];
}
