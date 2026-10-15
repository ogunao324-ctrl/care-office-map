"use client";

/**
 * 営業先のおすすめ（「需要と競合」の中）
 *
 * 選んだサービス（訪問介護など）が足りない場所にある、紹介元になる事業所
 * （介護なら居宅介護支援、障害なら相談支援）を並べる。
 * 足りない場所のケアマネは「頼める先が見つからない」ことが多いので、営業の効き目が大きい。
 * 選んだ所を Googleマップの道順でつないだり、名前・住所・電話の一覧をコピーしたりできる。
 */

import { useState } from "react";
import { GAP_RADIUS_KM } from "@/config";
import { shortageStep, type GapCell } from "@/lib/areas";
import { digitsOnly, formatDistance, type CategoryId, type LatLng } from "@/lib/offices";
import { MAX_WAYPOINTS, orderStops, routeUrl } from "@/lib/route";
import type { Row } from "./OfficeList";
import { ACT, ACT_MAIN, Note, PickChips } from "./ui";

export type SalesItem = { office: Row; cell: GapCell };
export type SalesSort = "short" | "near";

export function sortSales(items: SalesItem[], sort: SalesSort): SalesItem[] {
  const near = (a: SalesItem, b: SalesItem) => (a.office.distance ?? 99) - (b.office.distance ?? 99);
  const short = (a: SalesItem, b: SalesItem) => (a.cell.index ?? 9) - (b.cell.index ?? 9) || near(a, b);
  return [...items].sort(sort === "short" ? short : near);
}

const SHOW = 20;

export function SalesPanel({
  items,
  cat,
  catName,
  targetName,
  radiusKm,
  sort,
  onSort,
  selected,
  onToggle,
  onClear,
  highlightId,
  center,
  onFocus,
  onOpenOffice,
}: {
  items: SalesItem[];
  /** 足りないサービス（訪問介護など） */
  cat: CategoryId;
  catName: string;
  /** 営業先の種類（居宅介護支援・相談支援） */
  targetName: string;
  radiusKm: number;
  sort: SalesSort;
  onSort: (s: SalesSort) => void;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  highlightId: string | null;
  center: LatLng;
  onFocus: (id: string) => void;
  onOpenOffice: (id: string) => void;
}) {
  const [shown, setShown] = useState(SHOW);
  const [returnHome, setReturnHome] = useState(true);
  const [copied, setCopied] = useState(false);

  const chosen = items.filter((x) => selected.includes(x.office.id) && x.office.lat != null && x.office.lng != null);
  const ordered = orderStops(
    center,
    chosen.map((x) => ({ lat: x.office.lat as number, lng: x.office.lng as number, x })),
  );
  const url = routeUrl(center, ordered, returnHome);
  const full = selected.length >= MAX_WAYPOINTS;

  const copyList = async () => {
    const text = ordered
      .map(({ x }, i) => {
        const o = x.office;
        return [`${i + 1}. ${o.name}`, `   ${o.address}`, o.tel ? `   TEL ${o.tel}` : ""].filter(Boolean).join("\n");
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // コピーできない端末では何もしない
    }
  };

  return (
    <section className="grid gap-1.5" aria-label="営業先のおすすめ">
      <div className="grid gap-0.5 px-0.5">
        <h2 className="text-sm font-bold">営業先のおすすめ</h2>
        <p className="text-xs leading-relaxed text-muted">
          自社から{radiusKm}km以内で、まわり{GAP_RADIUS_KM}kmの{catName}が平均より少ない場所にある{targetName}
          <b className="text-ink"> {items.length}か所</b>。頼める{catName}が近くに少ないので、紹介をもらえる見込みが高い所です。
          左の四角に印を付けると、自社から近い順に回る道順を Googleマップで開けます（{MAX_WAYPOINTS}か所まで）。
        </p>
      </div>
      <PickChips
        label="並び"
        options={[
          { value: "short" as SalesSort, label: "足りない順" },
          { value: "near" as SalesSort, label: "近い順" },
        ]}
        value={sort}
        onChange={onSort}
      />

      {items.length === 0 ? (
        <Note>この範囲には、{catName}が足りない場所の{targetName}はありません。距離を広げてみてください。</Note>
      ) : (
        <ol className="grid gap-1.5">
          {items.slice(0, shown).map((x) => {
            const o = x.office;
            const on = selected.includes(o.id);
            const step = shortageStep(x.cell.index);
            return (
              <li
                key={o.id}
                id={`sales-${o.id}`}
                className={`card card-hover grid gap-1 px-3 py-2 ${highlightId === o.id ? "card-on" : on ? "border-accent/50" : ""}`}
              >
                <div className="grid grid-cols-[auto_1fr_auto] items-start gap-x-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`${o.name}を道順に入れる`}
                    disabled={!on && full}
                    onClick={() => onToggle(o.id)}
                    className={`mt-0.5 grid h-6 w-6 place-items-center rounded-md border-2 text-sm font-bold ${on ? "border-transparent bg-grad" : "border-rule bg-white text-transparent"} disabled:opacity-40`}
                  >
                    ✓
                  </button>
                  <button type="button" onClick={() => onFocus(o.id)} className="min-w-0 text-left">
                    <span className="block break-words text-[14px] font-bold leading-snug">{o.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      {step && (
                        <span className="inline-flex items-center gap-1 font-bold text-ink">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: step.color, opacity: Math.min(1, step.opacity + 0.3) }} />
                          {catName} 平均の{(x.cell.index ?? 0).toFixed(1)}倍
                        </span>
                      )}
                      {x.cell.n && <span>{x.cell.n}付近</span>}
                      {/* 同じ事業所で同じサービスもしているなら、自前で回すことが多い */}
                      {o.categories.includes(cat) && <span className="rounded bg-[#eef2f1] px-1.5 text-[11px] text-ink">同じ事業所で{catName}も</span>}
                    </span>
                  </button>
                  <span className="whitespace-nowrap text-sm tabular-nums">{formatDistance(o.distance)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[34px] text-xs text-muted">
                  <span className="break-words">{o.address}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-[34px]">
                  {o.tel && (
                    <a className={`${ACT} py-1 text-xs`} href={`tel:${digitsOnly(o.tel)}`}>
                      電話 {o.tel}
                    </a>
                  )}
                  <button type="button" className={`${ACT} py-1 text-xs`} onClick={() => onOpenOffice(o.id)}>
                    詳細
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > shown && (
        <button type="button" onClick={() => setShown((s) => s + SHOW)} className="w-full rounded-2xl border border-dashed border-accent/30 bg-white/40 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-white/80">
          さらに表示（残り {items.length - shown} か所）
        </button>
      )}

      {selected.length > 0 && (
        <div className="sticky bottom-0 z-10 grid gap-1.5 card card-hero px-3 py-2 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <b>{chosen.length}か所を選択中</b>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={returnHome} onChange={(e) => setReturnHome(e.target.checked)} />
              最後に自社へ戻る
            </label>
            <button type="button" onClick={onClear} className="ml-auto text-xs text-muted underline underline-offset-2">
              解除
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {url && (
              <a className={`${ACT} ${ACT_MAIN}`} target="_blank" rel="noopener" href={url}>
                道順を開く（Googleマップ）
              </a>
            )}
            <button type="button" className={ACT} onClick={copyList}>
              {copied ? "コピーしました" : "一覧をコピー"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
