"use client";

/**
 * 「競合の動き」の地図の下に出すもの：種類ごとの数の推移・新しく載った／載らなくなった事業所の一覧
 */

import { useState } from "react";
import {
  CHANGE_LABEL,
  countSeries,
  periodStartIndex,
  sourceOfCategory,
  ymLabel,
  type Change,
  type HistoryData,
} from "@/lib/history";
import { CATEGORIES, formatDistance, type CategoryId, type LatLng } from "@/lib/offices";
import { Note, ServiceChip } from "./ui";

/** 推移の小さな折れ線（1種類だけなので凡例は付けず、見出しが種類を表す） */
function Sparkline({ points, color, startIndex }: { points: { ym: string; count: number }[]; color: string; startIndex: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 240;
  const H = 52;
  const PAD_X = 6;
  const PAD_Y = 6;
  const n = points.length;
  if (n < 2) return null;
  const max = Math.max(...points.map((p) => p.count));
  const min = Math.min(...points.map((p) => p.count));
  // 縦軸は0からにしない（数十件の中の数件の増減を見たいので）。ただし同じ値ばかりのときは真ん中に
  const lo = Math.max(0, min - Math.max(1, Math.round((max - min) * 0.25)));
  const hi = max + Math.max(1, Math.round((max - min) * 0.15));
  const x = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / (n - 1);
  const y = (v: number) => H - PAD_Y - ((v - lo) / (hi - lo || 1)) * (H - PAD_Y * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)},${H - PAD_Y}L${x(0).toFixed(1)},${H - PAD_Y}Z`;
  const last = n - 1;
  const shown = hover ?? last;
  return (
    <div className="grid min-w-0 gap-0.5">
      <div className="relative h-[52px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full touch-none"
          role="img"
          aria-label={`${ymLabel(points[0].ym)}から${ymLabel(points[last].ym)}までの推移：${points.map((p) => p.count).join("、")}`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const rel = ((e.clientX - r.left) / r.width) * W;
            setHover(Math.max(0, Math.min(last, Math.round(((rel - PAD_X) / (W - PAD_X * 2)) * last))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <line x1={PAD_X} x2={W - PAD_X} y1={H - PAD_Y} y2={H - PAD_Y} stroke="#dde0d8" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {/* 期間の始まり（数の増減を比べている時点） */}
          <line x1={x(startIndex)} x2={x(startIndex)} y1={PAD_Y - 2} y2={H - PAD_Y} stroke="#c9cec6" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={area} fill={color} opacity="0.1" />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD_Y - 2} y2={H - PAD_Y} stroke="#5a6560" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <span
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
          style={{ left: `${(x(shown) / W) * 100}%`, top: `${(y(points[shown].count) / H) * 100}%`, background: color }}
        />
      </div>
      <div className="flex justify-between gap-2 text-[11px] tabular-nums text-muted">
        <span>{ymLabel(points[0].ym)}</span>
        <span className={hover != null ? "font-bold text-ink" : ""}>
          {hover != null ? `${ymLabel(points[hover].ym)}：${points[hover].count}か所` : ymLabel(points[last].ym)}
        </span>
      </div>
    </div>
  );
}

function ChangeRow({
  c,
  selected,
  hasCurrent,
  onSelect,
  onOpenOffice,
}: {
  c: Change;
  selected: boolean;
  hasCurrent: boolean;
  onSelect: () => void;
  onOpenOffice: () => void;
}) {
  const gone = c.kind === "closed" || c.kind === "dropped";
  return (
    <li id={`chg-${c.key}`} className={`rounded-lg border bg-white ${selected ? "border-accent ring-1 ring-accent" : "border-rule"}`}>
      <button type="button" onClick={onSelect} className="grid w-full grid-cols-[1fr_auto] gap-x-2.5 gap-y-0.5 px-3 py-2.5 text-left">
        <span className="min-w-0 break-words text-[15px] font-bold leading-snug">{c.name}</span>
        <span className="self-start whitespace-nowrap text-sm tabular-nums">{formatDistance(c.distance)}</span>
        <span className="col-span-2 flex flex-wrap items-center gap-1 text-xs text-muted">
          <span
            className={`rounded px-1.5 text-[11px] font-bold leading-relaxed ${gone ? "border border-dashed border-[#7a837f] text-[#5a6560]" : "bg-ink text-white"}`}
          >
            {CHANGE_LABEL[c.kind]}
          </span>
          {c.services.map((s) => (
            <ServiceChip key={s} service={s} />
          ))}
        </span>
        <span className="col-span-2 break-words text-xs text-muted">{c.address}</span>
      </button>
      {selected && (
        <div className="flex flex-wrap items-center gap-2 border-t border-rule px-3 py-2 text-xs text-muted">
          <span>
            {ymLabel(c.from)}の公表データには{gone ? "あり" : "なし"}、{ymLabel(c.to)}には{gone ? "なし" : "あり"}
          </span>
          {hasCurrent && (
            <button type="button" onClick={onOpenOffice} className="rounded-lg border border-rule bg-[#eef2f1] px-2.5 py-1 text-[12px] font-bold text-ink">
              事業所の詳細を見る
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function TrendPanel({
  history,
  error,
  center,
  radiusKm,
  cats,
  months,
  changes,
  selectedKey,
  onSelect,
  hasCurrent,
  onOpenOffice,
}: {
  history: HistoryData | null;
  error: string | null;
  center: LatLng | null;
  radiusKm: number;
  cats: Record<CategoryId, boolean>;
  months: number;
  changes: Change[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  hasCurrent: (c: Change) => boolean;
  onOpenOffice: (c: Change) => void;
}) {
  if (error) return <Note title="過去のデータを読み込めませんでした">通信状態を確認して、開き直してください。（{error}）</Note>;
  if (!history || !center) return <Note>過去の公表データを読み込んでいます…</Note>;

  const shownCats = CATEGORIES.filter((c) => c.id !== "ot" && cats[c.id]);
  const opened = changes.filter((c) => c.kind === "open" || c.kind === "added");
  const gone = changes.filter((c) => c.kind === "closed" || c.kind === "dropped");
  const periodText = (["kaigo", "shogai"] as const)
    .map((src) => {
      const s = history.snapshots[src];
      if (s.length < 2) return null;
      const S = periodStartIndex(s, months);
      return `${src === "kaigo" ? "介護" : "障害"} ${ymLabel(s[S])}→${ymLabel(s[s.length - 1])}`;
    })
    .filter(Boolean)
    .join("／");

  return (
    <div className="grid gap-2.5">
      <p className="px-0.5 text-xs text-muted">
        自社から{radiusKm}km以内の数と、比べている時点：{periodText}
      </p>

      {shownCats.length === 0 ? (
        <Note>サービスの種類を1つ以上選んでください。</Note>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {shownCats.map((cat) => {
            const series = countSeries(history, center, radiusKm, cat.id);
            const snaps = history.snapshots[sourceOfCategory(cat.id)];
            const S = periodStartIndex(snaps, months);
            const now = series.at(-1)?.count ?? 0;
            const before = series[S]?.count ?? now;
            const diff = now - before;
            return (
              <section key={cat.id} className="grid grid-cols-[auto_1fr] items-center gap-x-4 rounded-xl border border-rule bg-white p-3">
                <div className="grid gap-0.5">
                  <h3 className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: cat.color }} />
                    {cat.name}
                  </h3>
                  <p className="flex items-baseline gap-1 whitespace-nowrap">
                    <span className="text-2xl font-bold">{now}</span>
                    <span className="text-sm">か所</span>
                    <span className="ml-1 text-sm font-bold">{diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : "±0"}</span>
                  </p>
                  <p className="whitespace-nowrap text-[11px] text-muted">{ymLabel(snaps[S])}から</p>
                </div>
                <Sparkline points={series} color={cat.color} startIndex={S} />
              </section>
            );
          })}
        </div>
      )}

      <section className="grid gap-1.5" aria-label="新しく載った事業所">
        <div className="flex items-baseline justify-between px-0.5">
          <h2 className="text-sm font-bold">新しく載った事業所</h2>
          <span className="text-xs text-muted">{opened.length}件・近い順</span>
        </div>
        {opened.length === 0 ? (
          <Note>この期間・範囲で新しく載った事業所はありません。</Note>
        ) : (
          <ol className="grid gap-1.5">
            {opened.map((c) => (
              <ChangeRow
                key={c.key}
                c={c}
                selected={c.key === selectedKey}
                hasCurrent={hasCurrent(c)}
                onSelect={() => onSelect(c.key)}
                onOpenOffice={() => onOpenOffice(c)}
              />
            ))}
          </ol>
        )}
      </section>

      <section className="grid gap-1.5" aria-label="載らなくなった事業所">
        <div className="flex items-baseline justify-between px-0.5">
          <h2 className="text-sm font-bold">載らなくなった事業所</h2>
          <span className="text-xs text-muted">{gone.length}件・近い順</span>
        </div>
        {gone.length === 0 ? (
          <Note>この期間・範囲で載らなくなった事業所はありません。</Note>
        ) : (
          <ol className="grid gap-1.5">
            {gone.map((c) => (
              <ChangeRow
                key={c.key}
                c={c}
                selected={c.key === selectedKey}
                hasCurrent={hasCurrent(c)}
                onSelect={() => onSelect(c.key)}
                onOpenOffice={() => onOpenOffice(c)}
              />
            ))}
          </ol>
        )}
      </section>

      <p className="px-0.5 text-[11px] leading-relaxed text-muted">
        公表データ（介護：厚生労働省、障害：WAM NET）に載ったか・載らなくなったかで見ています。開設日・廃止日そのものではなく、
        公表の報告が遅れた事業所や、休止中の事業所も含みます。「サービス追加」「サービス終了」は、同じ事業所番号で別のサービスは続いているものです。
      </p>
    </div>
  );
}
