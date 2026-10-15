"use client";

/**
 * 「体制比較」の地図の下に出すもの
 *  - 範囲内の同じサービスの事業所の、利用者数・職員数などの中央値
 *  - 自社の数字を入れると、範囲内で何位くらいかが分かる（数字はこの端末にだけ保存）
 *  - 加算・医療処置を取っている事業所の割合
 *  - 選んだ数字の多い順のランキング（押すと詳しい体制）
 */

import { useState } from "react";
import {
  compareCatOf,
  kasanShares,
  median,
  METRIC_LABEL,
  metricOf,
  rankOf,
  tokuteiOf,
  usersOf,
  yesShares,
  type CompareCat,
  type DetailRecord,
  type DetailsData,
  type MetricId,
} from "@/lib/details";
import { formatDistance, kaigoPageUrl } from "@/lib/offices";
import type { Row } from "./OfficeList";
import { DetailFacts, fmtNum, signed, StaleBadge, TokuteiBadge, ymText } from "./DetailFacts";
import { ACT, Note } from "./ui";

export type CompareItem = { office: Row; d: DetailRecord | null; stale: boolean };

const SHOW = 30;
const SELF_KEY = "care-office-map:self-numbers";

type SelfNumbers = Partial<Record<CompareCat, { users?: string; staff?: string }>>;

function loadSelf(): SelfNumbers {
  try {
    return typeof window === "undefined" ? {} : (JSON.parse(localStorage.getItem(SELF_KEY) ?? "{}") as SelfNumbers);
  } catch {
    return {};
  }
}

function pct(a: number, b: number): string {
  return b ? `${Math.round((a / b) * 100)}%` : "—";
}

function valueText(m: MetricId, d: DetailRecord): string {
  const v = metricOf(d, m);
  if (v == null) return "—";
  switch (m) {
    case "users":
      return `${fmtNum(v)}人`;
    case "growth":
      return `${signed(v)}人`;
    case "staff":
      return `${fmtNum(v)}人`;
    case "fte":
      return `${fmtNum(v, 1)}人`;
    case "hours":
      return `${fmtNum(v)}時間`;
    case "start":
      return ymText(d.start);
  }
}

function Shares({ title, rows, note }: { title: string; rows: { name: string; count: number; of: number }[]; note?: string }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const list = all ? rows : rows.slice(0, 8);
  return (
    <section className="grid gap-1.5 card p-3" aria-label={title}>
      <h2 className="text-xs text-muted">{title}</h2>
      <ul className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-x-2 gap-y-1.5 text-[13px]">
        {list.map((r) => (
          <li key={r.name} className="contents">
            <span className={`break-words leading-snug ${r.name.startsWith("特定事業所") ? "font-bold" : ""}`}>{r.name}</span>
            <span className="h-2 overflow-hidden rounded-full bg-ink/[0.06]">
              <span className="block h-full rounded-full bar-fill" style={{ width: `${(r.count / Math.max(1, r.of)) * 100}%` }} />
            </span>
            <span className="whitespace-nowrap text-xs tabular-nums">
              <b>{r.count}</b>/{r.of}（{pct(r.count, r.of)}）
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 8 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="justify-self-start text-xs font-bold text-accent">
          {all ? "上位だけにする" : `すべて表示（${rows.length}項目）`}
        </button>
      )}
      {note && <p className="text-[11px] leading-relaxed text-muted">{note}</p>}
    </section>
  );
}

function SelfCompare({ cat, fresh }: { cat: CompareCat; fresh: DetailRecord[] }) {
  const [nums, setNums] = useState<SelfNumbers>(loadSelf);
  const mine = nums[cat] ?? {};
  const save = (patch: { users?: string; staff?: string }) => {
    const next = { ...nums, [cat]: { ...mine, ...patch } };
    setNums(next);
    try {
      localStorage.setItem(SELF_KEY, JSON.stringify(next));
    } catch {
      // 保存できない端末でも、その場の比較はできる
    }
  };
  const lines: { label: string; v: number; values: number[] }[] = [];
  const u = Number(mine.users);
  const s = Number(mine.staff);
  if (mine.users && Number.isFinite(u)) lines.push({ label: "利用者数", v: u, values: fresh.map((d) => usersOf(d)).filter((x): x is number => x != null) });
  if (mine.staff && Number.isFinite(s)) lines.push({ label: "職員数", v: s, values: fresh.map((d) => d.staff?.head).filter((x): x is number => x != null) });
  const cls = "field w-20 rounded-md px-2 py-1 text-right text-base tabular-nums outline-none";
  return (
    <section className="grid gap-1.5 card p-3" aria-label="自社と比べる">
      <h2 className="text-xs text-muted">自社の数字を入れて比べる（この端末にだけ保存）</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <label className="flex items-center gap-1.5">
          利用者
          <input inputMode="numeric" className={cls} value={mine.users ?? ""} onChange={(e) => save({ users: e.target.value.replace(/[^\d.]/g, "") })} />人
        </label>
        <label className="flex items-center gap-1.5">
          職員
          <input inputMode="numeric" className={cls} value={mine.staff ?? ""} onChange={(e) => save({ staff: e.target.value.replace(/[^\d.]/g, "") })} />人
        </label>
      </div>
      {lines.length > 0 ? (
        <ul className="grid gap-0.5 text-[13px]">
          {lines.map((l) => {
            const r = rankOf(l.values, l.v);
            return (
              <li key={l.label}>
                {l.label}は {l.values.length + 1}か所中 <b>{r}位</b>
                <span className="text-muted">（範囲内の中央値 {fmtNum(median(l.values) ?? undefined, 1)}人）</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted">自社は公表ページの数字に入っていないので、ここに入れると範囲内の順位が出ます。職員は実人数（常勤＋非常勤）です。</p>
      )}
    </section>
  );
}

export function ComparePanel({
  details,
  error,
  cat,
  radiusKm,
  metric,
  items,
  includeStale,
  onIncludeStale,
  selectedId,
  onSelect,
  onOpenOffice,
  forms,
  now,
}: {
  details: DetailsData | null;
  error: string | null;
  cat: CompareCat;
  radiusKm: number;
  metric: MetricId;
  /** 範囲内のこのサービスの事業所（並べ替え済み） */
  items: CompareItem[];
  includeStale: boolean;
  onIncludeStale: (v: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenOffice: (id: string) => void;
  forms?: Record<string, string>;
  now: Date;
}) {
  const [shown, setShown] = useState(SHOW);
  const info = compareCatOf(cat === "hh" ? "110" : "130");
  if (error)
    return (
      <Note title="公表ページの数字はまだありません">
        GitHub の Actions にある「公表ページの詳細の取得」が終わると、ここに職員数・利用者数・加算が並びます。（{error}）
      </Note>
    );
  if (!details || !info) return <Note>公表ページの数字を読み込んでいます…</Note>;

  const withData = items.filter((x) => x.d);
  const staleCount = withData.filter((x) => x.stale).length;
  const used = withData.filter((x) => includeStale || !x.stale).map((x) => x.d as DetailRecord);
  const ranked = items.filter((x) => x.d && (includeStale || !x.stale) && metricOf(x.d, metric) != null);
  const noData = items.filter((x) => !x.d);
  const med = (pick: (d: DetailRecord) => number | undefined) => median(used.map(pick).filter((x): x is number => x != null));
  const growth = used.filter((d) => d.users != null && d.usersPrev != null);
  const up = growth.filter((d) => (d.users as number) > (d.usersPrev as number)).length;
  const down = growth.filter((d) => (d.users as number) < (d.usersPrev as number)).length;
  const tokutei = used.filter((d) => d.kasanListed);
  const withTokutei = tokutei.filter((d) => tokuteiOf(d).length > 0).length;
  const max = Math.max(1, ...ranked.map((x) => Math.abs(metricOf(x.d as DetailRecord, metric) ?? 0)));

  return (
    <div className="grid gap-2.5">
      <section className="grid gap-1.5 card p-3">
        <h2 className="text-xs text-muted">自社から{radiusKm}km以内の{info.name}</h2>
        <p className="text-[15px] font-bold leading-snug">
          {items.length}か所・数字が分かるのは {withData.length}か所
        </p>
        {used.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
            <dt className="text-muted">利用者（中央値）</dt>
            <dd className="tabular-nums">
              <b>{fmtNum(med(usersOf) ?? undefined, 1)}人</b>
            </dd>
            <dt className="text-muted">{info.staff}（中央値）</dt>
            <dd className="tabular-nums">
              <b>{fmtNum(med((d) => d.staff?.head) ?? undefined, 1)}人</b>
              <span className="text-muted">・常勤換算 {fmtNum(med((d) => d.staff?.fte) ?? undefined, 1)}人</span>
            </dd>
            {cat === "hh" && (
              <>
                <dt className="text-muted">1か月の提供（中央値）</dt>
                <dd className="tabular-nums">{fmtNum(med((d) => metricOf(d, "hours")) ?? undefined)}時間</dd>
              </>
            )}
            {growth.length > 0 && (
              <>
                <dt className="text-muted">前年より利用者が</dt>
                <dd className="tabular-nums">
                  増えた所 <b>{up}</b>・減った所 <b>{down}</b>・同じ {growth.length - up - down}
                </dd>
              </>
            )}
            {cat !== "vn" && tokutei.length > 0 && (
              <>
                <dt className="text-muted">特定事業所加算</dt>
                <dd className="tabular-nums">
                  <b>{withTokutei}</b>/{tokutei.length}か所が取得（{pct(withTokutei, tokutei.length)}）
                </dd>
              </>
            )}
          </dl>
        )}
        {staleCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/15 bg-accent/[0.06] px-2.5 py-1.5 text-xs">
            <span className="text-muted">
              記入が2年以上前の{staleCount}か所を{includeStale ? "含めています" : "除いています"}
            </span>
            <button type="button" onClick={() => onIncludeStale(!includeStale)} className="font-bold text-accent">
              {includeStale ? "除く" : "含める"}
            </button>
          </div>
        )}
      </section>

      <SelfCompare key={cat} cat={cat} fresh={used} />

      <Shares
        title="加算を取っている事業所（数字が分かる事業所のうち）"
        rows={kasanShares(used)}
        note={
          cat === "vn"
            ? "加算は記入日の前月から1年間に算定したものです。緊急時訪問看護加算は24時間の連絡・訪問の体制、特別管理加算は医療的な管理が要る利用者への訪問、看護体制強化加算は重い利用者の受け入れが多い事業所が取れます。"
            : cat === "hh"
              ? "加算は記入日の前月から1年間に算定したものです。特定事業所加算は研修・会議などの体制と、介護福祉士の割合や重い利用者の受け入れなどの要件を満たす事業所が取れます。処遇改善加算は職員の賃上げのためのものです。"
              : "加算は記入日の前月から1年間に算定したものです。特定事業所加算は主任ケアマネ・常勤ケアマネの人数や24時間の連絡体制などの要件を満たす事業所が取れます。"
        }
      />
      {cat === "vn" && <Shares title="この1年に実施した医療処置" rows={yesShares(used, (d) => d.treat)} />}

      <section className="grid gap-1.5" aria-label="体制のランキング">
        <div className="flex items-baseline justify-between px-0.5">
          <h2 className="text-sm font-bold">{METRIC_LABEL[metric]}</h2>
          <span className="text-xs text-muted">{metric === "start" ? "新しい順" : "多い順"}</span>
        </div>
        {ranked.length === 0 ? (
          <Note>この範囲には、比べられる数字のある事業所がありません。距離を広げてみてください。</Note>
        ) : (
          <ol className="grid gap-1.5">
            {ranked.slice(0, shown).map((x, i) => {
              const d = x.d as DetailRecord;
              const v = metricOf(d, metric) ?? 0;
              const open = selectedId === x.office.id;
              const page = x.office.kaigoPages?.find((p) => p.code === info.code);
              const users = usersOf(d);
              return (
                <li key={x.office.id} id={`cmp-${x.office.id}`} className={`card card-hover ${open ? "card-on" : ""}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(x.office.id)}
                    aria-expanded={open}
                    className="grid w-full grid-cols-[1.6em_1fr_auto] items-baseline gap-x-2 gap-y-1 px-3 py-2 text-left"
                  >
                    <span className="text-xs tabular-nums text-muted">{i + 1}</span>
                    <span className={`min-w-0 break-words text-[14px] font-bold leading-snug ${x.stale ? "text-muted" : ""}`}>{x.office.name}</span>
                    <span className="whitespace-nowrap text-sm font-bold tabular-nums">{valueText(metric, d)}</span>
                    {metric !== "start" && (
                      <>
                        <span />
                        <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                          <span
                            className={`block h-full rounded-full ${v < 0 ? "bg-linear-to-r from-[#b45309] to-[#f59e0b]" : "bar-fill"}`}
                            style={{ width: `${(Math.abs(v) / max) * 100}%` }}
                          />
                        </span>
                      </>
                    )}
                    <span />
                    <span className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      {metric !== "users" && users != null && <span>利用者 {fmtNum(users)}人</span>}
                      {metric !== "staff" && d.staff?.head != null && <span>職員 {fmtNum(d.staff.head)}人</span>}
                      <span>{formatDistance(x.office.distance)}</span>
                      <TokuteiBadge d={d} />
                      <StaleBadge d={d} now={now} />
                    </span>
                  </button>
                  {open && (
                    <div className="grid gap-2 border-t border-rule px-3 pb-3 pt-2">
                      {x.office.corp && <p className="text-xs text-muted">{x.office.corp}</p>}
                      <DetailFacts d={d} code={info.code} now={now} />
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" className={ACT} onClick={() => onOpenOffice(x.office.id)}>
                          事業所の詳細（電話など）
                        </button>
                        {page && (
                          <a className={ACT} target="_blank" rel="noopener" href={kaigoPageUrl(page, forms)}>
                            公表ページ
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {ranked.length > shown && (
          <button type="button" onClick={() => setShown((s) => s + SHOW)} className="w-full rounded-2xl border border-dashed border-accent/30 bg-accent/[0.04] py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/10">
            さらに表示（残り {ranked.length - shown} か所）
          </button>
        )}
      </section>

      {noData.length > 0 && (
        <details className="card p-3 text-[13px]">
          <summary className="cursor-pointer text-xs text-muted">数字の分からない事業所 {noData.length}か所</summary>
          <ul className="mt-1.5 grid gap-0.5">
            {noData.map((x) => (
              <li key={x.office.id}>
                <button type="button" className="text-left underline decoration-rule underline-offset-2" onClick={() => onOpenOffice(x.office.id)}>
                  {x.office.name}
                </button>
                <span className="text-xs text-muted">（{formatDistance(x.office.distance)}）</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">公表ページがまだ無い（新しい事業所など）か、まだ取得していない事業所です。</p>
        </details>
      )}

      <p className="px-0.5 text-[11px] leading-relaxed text-muted">
        出典：「介護サービス情報公表システム」（厚生労働省）の各事業所の公表ページ（基本情報）から読み取り・加工（{ymText(details.generatedAt.slice(0, 10))}時点で取得）。
        数字は各事業所が記入した日の前月（採用・退職は前年度）のものです。職員は実人数（常勤＋非常勤）、常勤換算は勤務時間を常勤の人数に直したもの。
        {cat === "vn" && "訪問看護の利用者数は医療保険の利用者も含めた数（無いときは介護保険の利用者数）、前年との比較は介護保険の利用者だけです。"}
        自社の経営の分析のためにだけ使ってください。
      </p>
    </div>
  );
}
