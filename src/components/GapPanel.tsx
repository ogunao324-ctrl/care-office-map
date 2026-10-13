"use client";

/**
 * 「需要と競合」の地図の下に出すもの：自社のまわりのまとめ・選んだマス・凡例・足りない町のランキング
 */

import { COUNT_COLORS, DEMAND_LABEL, SHORTAGE_STEPS, type DemandBase, type GapCell, type GapResult } from "@/lib/areas";
import { CATEGORIES, formatDistance, type CategoryId } from "@/lib/offices";
import { GAP_RADIUS_KM } from "@/config";
import { fmtInt, Note } from "./ui";

export type ColorMode = "short" | "count";

function ratioText(r: number | null): string {
  return r == null ? "—" : r.toFixed(2);
}

function indexText(i: number | null): string {
  if (i == null) return "判定なし（人が少ない）";
  return `平均の${i.toFixed(1)}倍`;
}

function CellFacts({ g, base, catName }: { g: GapCell; base: DemandBase; catName: string }) {
  return (
    <p className="text-[13px] leading-relaxed text-muted">
      半径{GAP_RADIUS_KM}kmに{DEMAND_LABEL[base]} <b className="text-ink">{fmtInt(g.demand)}人</b>、{catName}{" "}
      <b className="text-ink">{g.supply}か所</b>
      {g.ratio != null && <>（1,000人あたり {ratioText(g.ratio)}か所）</>}
      <br />
      このマス（500m四方）の{DEMAND_LABEL[base]}：{fmtInt(g[base])}人
    </p>
  );
}

export function GapPanel({
  gap,
  error,
  category,
  base,
  colorMode,
  radiusKm,
  ranking,
  selfCell,
  selectedCell,
  breaks,
  onPickCell,
}: {
  gap: GapResult | null;
  error: string | null;
  category: CategoryId;
  base: DemandBase;
  colorMode: ColorMode;
  radiusKm: number;
  ranking: GapCell[];
  selfCell: GapCell | null;
  selectedCell: GapCell | null;
  breaks: number[];
  onPickCell: (code: string) => void;
}) {
  const catName = CATEGORIES.find((c) => c.id === category)?.name ?? "";
  if (error) return <Note title="人口のデータを読み込めませんでした">通信状態を確認して、開き直してください。（{error}）</Note>;
  if (!gap) return <Note>人口のデータを読み込んでいます…</Note>;

  return (
    <div className="grid gap-2.5">
      {selectedCell && (
        <section className="grid gap-1 rounded-xl border border-ink bg-white p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="min-w-0 break-words text-[15px] font-bold">{selectedCell.n ? `${selectedCell.n}付近` : "このマス"}</h2>
            <span className="shrink-0 text-xs text-muted">自社から{formatDistance(selectedCell.distance)}</span>
          </div>
          <p className="text-sm font-bold">{indexText(selectedCell.index)}</p>
          <CellFacts g={selectedCell} base={base} catName={catName} />
        </section>
      )}

      <section className="grid gap-1.5 rounded-xl border border-rule bg-white p-3">
        <h2 className="text-xs text-muted">自社のまわり（半径{GAP_RADIUS_KM}km）</h2>
        {selfCell ? (
          <>
            <p className="text-[15px] font-bold leading-snug">
              {DEMAND_LABEL[base]} {fmtInt(selfCell.demand)}人に、{catName} {selfCell.supply}か所
            </p>
            <p className="text-[13px] text-muted">
              1,000人あたり {ratioText(selfCell.ratio)}か所・10km圏の平均は {ratioText(gap.average)}か所（{indexText(selfCell.index)}）
            </p>
          </>
        ) : (
          <p className="text-[13px] text-muted">自社のマスの人口データがありません。</p>
        )}
      </section>

      <section className="grid gap-1.5 rounded-xl border border-rule bg-white p-3" aria-label="地図の色の見方">
        <h2 className="text-xs text-muted">
          地図の色：{colorMode === "short" ? `${catName}の足りなさ（10km圏の平均と比べて）` : `500m四方ごとの${DEMAND_LABEL[base]}の人数`}
        </h2>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {colorMode === "short"
            ? SHORTAGE_STEPS.filter((s) => s.label !== "ふつう").map((s) => (
                <li key={s.label} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ background: s.color, opacity: Math.min(1, s.opacity + 0.25) }} />
                  {s.label}
                </li>
              ))
            : COUNT_COLORS.map((c, i) => (
                <li key={c} className="flex items-center gap-1.5 tabular-nums">
                  <span className="h-3 w-3 rounded-sm" style={{ background: c }} />
                  {i === 0 ? `〜${fmtInt(breaks[0])}` : i === COUNT_COLORS.length - 1 ? `${fmtInt(breaks[i - 1])}〜` : `〜${fmtInt(breaks[i])}`}人
                </li>
              ))}
        </ul>
        {colorMode === "short" && (
          <p className="text-[11px] leading-relaxed text-muted">
            色の無いところは「ふつう」か、半径{GAP_RADIUS_KM}kmの{DEMAND_LABEL[base]}が少なく判定しない場所です。地図のマスを押すと数字が見られます。
          </p>
        )}
      </section>

      <section className="grid gap-1.5" aria-label="事業所が足りない町">
        <div className="flex items-baseline justify-between px-0.5">
          <h2 className="text-sm font-bold">{catName}が足りない町</h2>
          <span className="text-xs text-muted">自社から{radiusKm}km以内・少ない順</span>
        </div>
        {ranking.length === 0 ? (
          <Note>この範囲には、平均より少ない町はありません。距離を広げてみてください。</Note>
        ) : (
          <ol className="grid gap-1.5">
            {ranking.map((g, i) => (
              <li key={g.c}>
                <button
                  type="button"
                  onClick={() => onPickCell(g.c)}
                  className={`grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-x-2 rounded-lg border bg-white px-3 py-2 text-left ${selectedCell?.c === g.c ? "border-ink" : "border-rule"}`}
                >
                  <span className="text-xs tabular-nums text-muted">{i + 1}</span>
                  <span className="min-w-0 break-words text-[14px] font-bold">{g.n ? `${g.n}付近` : "名前のない場所"}</span>
                  <span className="whitespace-nowrap text-[13px] font-bold">{indexText(g.index)}</span>
                  <span />
                  <span className="col-span-2 text-xs text-muted">
                    自社から{formatDistance(g.distance)}・半径{GAP_RADIUS_KM}kmに{DEMAND_LABEL[base]} {fmtInt(g.demand)}人、{catName} {g.supply}か所
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="px-0.5 text-[11px] leading-relaxed text-muted">
        数え方：500m四方のマスごとに、マスの中心から半径{GAP_RADIUS_KM}km以内に住む{DEMAND_LABEL[base]}の人数（2020年国勢調査）と、
        同じ範囲にある{catName}の数（最新の公表データ）を数え、1,000人あたりの事業所数を出しています。
        10km圏全体の値（{DEMAND_LABEL[base]} {fmtInt(gap.totalDemand)}人に{gap.totalSupply}か所＝1,000人あたり{ratioText(gap.average)}か所）と比べた倍率で色分けしています。
        人口は5年前の国勢調査なので、新しい住宅地などは実際より少なく出ます。
      </p>
    </div>
  );
}
