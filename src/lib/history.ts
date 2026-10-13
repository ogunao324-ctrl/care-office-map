/**
 * 競合の動き（開設・廃止）
 *
 * 公表データの過去の時点（介護：2020年12月末〜、障害：2021年11月末〜）を並べ、
 * 事業所番号ごとに「どの時点の公表データに載っていたか」を持つ（public/data/history.json）。
 * 前の時点に無くて今ある → 新しく載った（新規開設、または既存の事業所がそのサービスを始めた）
 * 前の時点にあって今は無い → 載らなくなった（廃止・休止、または公表をやめた）
 *
 * 注意：公表データに「載ったか」で見ているので、開設日・廃止日そのものではない。
 */

import { categoryOf, distanceKm, type CategoryId, type LatLng } from "./offices";

export type HistorySource = "kaigo" | "shogai";

export const SOURCE_LABEL: Record<HistorySource, string> = { kaigo: "介護", shogai: "障害" };

export type HistoryOffice = {
  /** 出どころ（介護＝厚労省、障害＝WAM NET）。時点の並びが違う */
  src: HistorySource;
  /** サービス名（公表データの表記） */
  s: string;
  /** 事業所番号（無いときは名前と住所から作った代わりの文字列） */
  no: string;
  n: string;
  a: string;
  la: number | null;
  lo: number | null;
  /** snapshots[src] の各時点に載っていたか（"1"／"0"） */
  p: string;
};

export type HistoryData = {
  generatedAt: string;
  /** 時点（"2026-06" のような年-月）。古い順 */
  snapshots: Record<HistorySource, string[]>;
  offices: HistoryOffice[];
};

export function ymLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月末`;
}

function ymIndex(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

export const KAIGO_CATEGORIES: CategoryId[] = ["cm", "hh", "vn"];
export const SHOGAI_CATEGORIES: CategoryId[] = ["dv", "cs"];

export function sourceOfCategory(c: CategoryId): HistorySource {
  return SHOGAI_CATEGORIES.includes(c) ? "shogai" : "kaigo";
}

function within(o: HistoryOffice, center: LatLng, radiusKm: number): number | null {
  if (o.la == null || o.lo == null) return null;
  const d = distanceKm(center, { lat: o.la, lng: o.lo });
  return d <= radiusKm + 1e-9 ? d : null;
}

/** 種類ごとの、各時点で範囲内にあった事業所の数（同じ番号の事業所は1と数える） */
export function countSeries(
  h: HistoryData,
  center: LatLng,
  radiusKm: number,
  category: CategoryId,
): { ym: string; count: number }[] {
  const src = sourceOfCategory(category);
  const snaps = h.snapshots[src];
  const sets = snaps.map(() => new Set<string>());
  for (const o of h.offices) {
    if (o.src !== src || categoryOf(o.s) !== category) continue;
    if (within(o, center, radiusKm) == null) continue;
    for (let i = 0; i < snaps.length; i++) if (o.p[i] === "1") sets[i].add(o.no);
  }
  return snaps.map((ym, i) => ({ ym, count: sets[i].size }));
}

export type ChangeKind = "open" | "added" | "closed" | "dropped";

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  open: "新規",
  added: "サービス追加",
  closed: "なくなった",
  dropped: "サービス終了",
};

export type Change = {
  key: string;
  src: HistorySource;
  no: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  distance: number;
  kind: ChangeKind;
  services: string[];
  categories: CategoryId[];
  from: string;
  to: string;
};

/**
 * 期間（months か月）のあいだに、範囲内で新しく載った／載らなくなった事業所。
 * 期間の始まりは「最新の時点から months か月以上前の、いちばん新しい時点」。
 * 事業所番号ごとにまとめ、番号自体が前から載っていればサービス追加・終了として扱う。
 */
export function periodChanges(h: HistoryData, center: LatLng, radiusKm: number, months: number): Change[] {
  const out: Change[] = [];
  for (const src of ["kaigo", "shogai"] as HistorySource[]) {
    const snaps = h.snapshots[src];
    if (snaps.length < 2) continue;
    const L = snaps.length - 1;
    const limit = ymIndex(snaps[L]) - months;
    let S = 0;
    for (let i = 0; i < L; i++) if (ymIndex(snaps[i]) <= limit) S = i;
    if (S >= L) S = L - 1;

    const byNo = new Map<string, HistoryOffice[]>();
    for (const o of h.offices) {
      if (o.src !== src) continue;
      const list = byNo.get(o.no) ?? [];
      list.push(o);
      byNo.set(o.no, list);
    }
    for (const [no, list] of byNo) {
      const ref = list.find((o) => o.la != null) ?? list[0];
      const distance = within(ref, center, radiusKm);
      if (distance == null) continue;
      const atStart = list.filter((o) => o.p[S] === "1");
      const atEnd = list.filter((o) => o.p[L] === "1");
      const started = atEnd.filter((o) => o.p[S] !== "1");
      const ended = atStart.filter((o) => o.p[L] !== "1");
      const base = { src, no, distance, from: snaps[S], to: snaps[L] };
      if (started.length) {
        const latest = started[0];
        out.push({
          ...base,
          key: `${src}|${no}|+`,
          name: latest.n,
          address: latest.a,
          lat: latest.la,
          lng: latest.lo,
          kind: atStart.length ? "added" : "open",
          services: started.map((o) => o.s),
          categories: [...new Set(started.map((o) => categoryOf(o.s)))],
        });
      }
      if (ended.length) {
        const last = ended[0];
        out.push({
          ...base,
          key: `${src}|${no}|-`,
          name: last.n,
          address: last.a,
          lat: last.la,
          lng: last.lo,
          kind: atEnd.length ? "dropped" : "closed",
          services: ended.map((o) => o.s),
          categories: [...new Set(ended.map((o) => categoryOf(o.s)))],
        });
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}
