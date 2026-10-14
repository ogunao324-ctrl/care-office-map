"use client";

/**
 * 「法人の勢力」の地図の下に出すもの：選んだ法人の事業所・全体のまとめ・法人の種類・法人ランキング
 */

import { useState } from "react";
import { CORP_TYPE_LABEL, type CorpLandscape, type CorpSummary } from "@/lib/corps";
import { CATEGORIES, CATEGORY_ORDER, formatDistance, type CategoryId } from "@/lib/offices";
import { fmtInt, Note, ServiceChip } from "./ui";

const SHOW = 30;

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** 種類ごとの数（色の点＋数字）。色だけに頼らないよう、短い名前も添える */
const SHORT: Record<CategoryId, string> = { cm: "居宅", hh: "訪問介護", vn: "看護", dv: "障害訪問", cs: "相談", ot: "他" };

function CatCounts({ byCat }: { byCat: Record<CategoryId, number> }) {
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
      {CATEGORY_ORDER.filter((c) => byCat[c] > 0).map((c) => (
        <span key={c} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="h-2 w-2 rounded-full" style={{ background: CATEGORIES.find((x) => x.id === c)?.color }} />
          {SHORT[c]}
          <b className="tabular-nums text-ink">{byCat[c]}</b>
        </span>
      ))}
    </span>
  );
}

function SelectedCorp({
  corp,
  radiusKm,
  onClose,
  onOpenOffice,
}: {
  corp: CorpSummary;
  radiusKm: number;
  onClose: () => void;
  onOpenOffice: (id: string) => void;
}) {
  return (
    <section className="grid gap-2 rounded-xl border border-ink bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-words text-[15px] font-bold leading-snug">{corp.name}</h2>
          <p className="text-xs text-muted">{CORP_TYPE_LABEL[corp.type]}</p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-full border border-rule px-2.5 py-0.5 text-xs">
          閉じる
        </button>
      </div>
      <p className="text-sm">
        {radiusKm}km以内に <b>{corp.offices.length}か所</b>・10km圏で {corp.all.length}か所
        {corp.both && <span className="ml-1.5 rounded bg-[#eef2f1] px-1.5 text-[11px] font-bold">介護＋障害</span>}
      </p>
      <p className="text-xs text-muted">
        <CatCounts byCat={corp.byCat} />
      </p>
      <ol className="grid gap-1 border-t border-rule pt-2">
        {corp.all.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => onOpenOffice(o.id)} className="grid w-full grid-cols-[1fr_auto] gap-x-2 rounded-md px-1 py-1 text-left hover:bg-[#f3f5f2]">
              <span className="min-w-0 break-words text-[13px] font-bold">{o.name}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-muted">{formatDistance(o.distance)}</span>
              <span className="col-span-2 flex flex-wrap gap-1">
                {o.services.map((s) => (
                  <ServiceChip key={s} service={s} />
                ))}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-muted">事業所名を押すと、その事業所の詳細（電話・公表ページなど）に移ります。</p>
    </section>
  );
}

export function CorpPanel({
  land,
  radiusKm,
  selected,
  onSelectCorp,
  onOpenOffice,
}: {
  land: CorpLandscape | null;
  radiusKm: number;
  selected: CorpSummary | null;
  onSelectCorp: (key: string | null) => void;
  onOpenOffice: (id: string) => void;
}) {
  const [shown, setShown] = useState(SHOW);
  if (!land) return <Note>事業所データを読み込んでいます…</Note>;
  const counted = land.corps.reduce((s, c) => s + c.offices.length, 0);
  const max = land.corps[0]?.offices.length ?? 1;

  return (
    <div className="grid gap-2.5">
      {selected && (
        <SelectedCorp corp={selected} radiusKm={radiusKm} onClose={() => onSelectCorp(null)} onOpenOffice={onOpenOffice} />
      )}

      <section className="grid gap-1.5 rounded-xl border border-rule bg-white p-3">
        <h2 className="text-xs text-muted">自社から{radiusKm}km以内</h2>
        <p className="text-[15px] font-bold leading-snug">
          {fmtInt(land.corps.length)}法人が {fmtInt(counted)}か所
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
          <dt className="text-muted">上位5法人の割合</dt>
          <dd className="font-bold tabular-nums">{pct(land.top5Share)}</dd>
          <dt className="text-muted">1か所だけの法人</dt>
          <dd className="tabular-nums">
            <b>{fmtInt(land.singles)}法人</b>
            {land.corps.length > 0 && <span className="text-muted">（法人の{pct(land.singles / land.corps.length)}）</span>}
          </dd>
        </dl>
        <p className="text-[11px] leading-relaxed text-muted">
          上位5法人の割合が低いほど小さな事業所が多い「ばらけた」地域、高いほど大手が強い地域です。
          {land.noCorp > 0 && `法人名が公表されていない事業所 ${land.noCorp}か所は数えていません。`}
        </p>
      </section>

      {land.byType.length > 0 && (
        <section className="grid gap-1.5 rounded-xl border border-rule bg-white p-3" aria-label="法人の種類">
          <h2 className="text-xs text-muted">法人の種類（事業所の数）</h2>
          {/* 行をまたいで棒の始まりが揃うよう、1つの表の形（grid）に並べる */}
          <ul className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5 text-[13px]">
            {land.byType.map((t) => (
              <li key={t.type} className="contents">
                <span className="truncate">{CORP_TYPE_LABEL[t.type].replace(/（.*）/, "")}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[#eef2f1]">
                  <span className="block h-full rounded-full bg-ink" style={{ width: `${(t.offices / Math.max(1, counted)) * 100}%` }} />
                </span>
                <span className="whitespace-nowrap text-xs tabular-nums">
                  <b>{t.offices}</b>か所・{t.corps}法人（{pct(t.offices / Math.max(1, counted))}）
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-1.5" aria-label="法人ランキング">
        <div className="flex items-baseline justify-between px-0.5">
          <h2 className="text-sm font-bold">事業所の多い法人</h2>
          <span className="text-xs text-muted">{radiusKm}km以内の数・多い順</span>
        </div>
        {land.corps.length === 0 ? (
          <Note>この条件に合う法人はありません。</Note>
        ) : (
          <ol className="grid gap-1.5">
            {land.corps.slice(0, shown).map((c, i) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => onSelectCorp(selected?.key === c.key ? null : c.key)}
                  className={`grid w-full grid-cols-[1.5em_1fr_auto] items-baseline gap-x-2 gap-y-1 rounded-lg border bg-white px-3 py-2 text-left ${selected?.key === c.key ? "border-ink" : "border-rule"}`}
                >
                  <span className="text-xs tabular-nums text-muted">{i + 1}</span>
                  <span className="min-w-0 break-words text-[14px] font-bold leading-snug">{c.name}</span>
                  <span className="whitespace-nowrap text-sm tabular-nums">
                    <b>{c.offices.length}</b>か所
                  </span>
                  <span />
                  <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-[#eef2f1]">
                    <span className="block h-full rounded-full bg-ink" style={{ width: `${(c.offices.length / max) * 100}%` }} />
                  </span>
                  <span />
                  <span className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                    <span>{CORP_TYPE_LABEL[c.type].replace(/（.*）/, "")}</span>
                    {c.both && <span className="rounded bg-[#eef2f1] px-1.5 text-[11px] font-bold text-ink">介護＋障害</span>}
                    <CatCounts byCat={c.byCat} />
                    <span>最寄り {formatDistance(c.nearest)}</span>
                    {c.all.length > c.offices.length && <span>（10km圏で{c.all.length}か所）</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {land.corps.length > shown && (
          <button
            type="button"
            onClick={() => setShown((s) => s + SHOW)}
            className="w-full rounded-lg border border-dashed border-rule py-2.5 text-sm text-muted"
          >
            さらに表示（残り {land.corps.length - shown} 法人）
          </button>
        )}
      </section>

      <p className="px-0.5 text-[11px] leading-relaxed text-muted">
        数え方：公表データの法人番号で同じ法人をまとめています（番号が無いものは法人名で）。1つの事業所が介護と障害の両方の指定を受けていても1か所と数えます。
        種類ごとの数は、その種類のサービスをしている事業所の数です。
      </p>
    </div>
  );
}
