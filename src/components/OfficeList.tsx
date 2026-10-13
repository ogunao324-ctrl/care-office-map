"use client";

/**
 * 「事業所をさがす」の一覧の1行・詳細・データについて
 */

import { useState } from "react";
import { digitsOnly, formatDistance, kaigoPageUrl, WAM_SEARCH_URL, type Office, type OfficeData } from "@/lib/offices";
import { ACT, ServiceChip } from "./ui";

/** 一覧の1件（距離と検索用の文字を足したもの） */
export type Row = Office & { distance: number | null; key: string };

export function OfficeRow({
  office: o,
  open,
  sameSpot,
  center,
  forms,
  onToggle,
}: {
  office: Row;
  open: boolean;
  sameSpot: number;
  center: { lat: number; lng: number } | null;
  forms?: Record<string, string>;
  onToggle: () => void;
}) {
  const both =
    o.categories.some((c) => c === "cm" || c === "hh" || c === "vn") && o.categories.some((c) => c === "dv" || c === "cs");
  return (
    <li id={`row-${o.id}`} className={`rounded-lg border bg-white ${open ? "border-accent ring-1 ring-accent" : "border-rule"}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid w-full grid-cols-[1fr_auto] gap-x-2.5 gap-y-0.5 px-3 py-2.5 text-left">
        <span className="min-w-0 break-words text-[15px] font-bold leading-snug">{o.name}</span>
        <span className="self-start whitespace-nowrap text-sm tabular-nums">{o.self ? "自社" : formatDistance(o.distance)}</span>
        <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted">
          {o.self && <span className="rounded bg-accent px-1.5 text-[11px] font-bold leading-relaxed text-white">自社</span>}
          {both && <span className="rounded bg-[#eef2f1] px-1.5 text-[11px] font-bold leading-relaxed">介護＋障害</span>}
          {o.services.map((s) => (
            <ServiceChip key={s} service={s} />
          ))}
          {o.corp && <span>{o.corp}</span>}
        </span>
        <span className="col-span-2 break-words text-xs text-muted">{o.address}</span>
      </button>
      {open && <OfficeDetail office={o} sameSpot={sameSpot} center={center} forms={forms} />}
    </li>
  );
}

function OfficeDetail({
  office: o,
  sameSpot,
  center,
  forms,
}: {
  office: Row;
  sameSpot: number;
  center: { lat: number; lng: number } | null;
  forms?: Record<string, string>;
}) {
  const [copied, setCopied] = useState(false);
  const [nameCopied, setNameCopied] = useState(false);
  const hasShogai = o.categories.some((c) => c === "dv" || c === "cs");
  // WAM NET は事業所ページへ直接行けないので、名前をコピーしてから検索の入口を開く
  const copyName = () => {
    try {
      navigator.clipboard.writeText(o.name).then(
        () => setNameCopied(true),
        () => undefined,
      );
    } catch {
      // コピーできない端末でも、リンクはそのまま開く
    }
  };
  const copyTel = async () => {
    if (!o.tel) return;
    try {
      await navigator.clipboard.writeText(o.tel);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // コピーできない端末では、番号を長押しで選んでもらう
    }
  };
  const act = ACT;
  return (
    <div className="grid gap-2 border-t border-rule px-3 pb-3 pt-2.5 text-sm">
      <dl className="grid grid-cols-[5.5em_1fr] gap-x-2.5 gap-y-0.5">
        {o.tel && <Item label="電話"><span className="select-all tabular-nums">{o.tel}</span></Item>}
        {o.fax && <Item label="FAX"><span className="select-all tabular-nums">{o.fax}</span></Item>}
        {o.numbers.length > 0 && <Item label="事業所番号"><span className="select-all tabular-nums">{o.numbers.join("、")}</span></Item>}
        {o.capacity.length > 0 && <Item label="定員">{o.capacity.join("、")}</Item>}
        {o.days && <Item label="曜日">{o.days}</Item>}
        {o.corp && <Item label="法人">{o.corp}</Item>}
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {o.lat != null && o.lng != null && (
          <>
            <a className={`${act} border-accent bg-accent text-white`} target="_blank" rel="noopener" href={`https://www.google.com/maps/search/?api=1&query=${o.lat}%2C${o.lng}`}>
              Googleマップ
            </a>
            {center && !o.self && (
              <a className={act} target="_blank" rel="noopener" href={`https://www.google.com/maps/dir/?api=1&origin=${center.lat}%2C${center.lng}&destination=${o.lat}%2C${o.lng}&travelmode=driving`}>
                自社からの道順
              </a>
            )}
          </>
        )}
        {o.tel && (
          <>
            <a className={act} href={`tel:${digitsOnly(o.tel)}`}>電話をかける</a>
            <button type="button" className={act} onClick={copyTel}>{copied ? "コピーしました" : "番号をコピー"}</button>
          </>
        )}
        {/* ホームページは公表データに載っているときだけ押せる。無いときは灰色で押せない */}
        {o.url ? (
          <a className={act} target="_blank" rel="noopener" href={o.url}>ホームページ</a>
        ) : (
          <button type="button" disabled className={`${act} cursor-not-allowed opacity-45`}>ホームページなし</button>
        )}
      </div>
      {((o.kaigoPages?.length ?? 0) > 0 || hasShogai) && (
        <div className="grid gap-1.5 rounded-lg bg-[#f3f5f2] p-2.5">
          <p className="text-xs text-muted">公表ページ（従業者の数・決算書類などが見られます）</p>
          <div className="flex flex-wrap gap-1.5">
            {o.kaigoPages?.map((p) => (
              <a key={p.code} className={`${act} bg-white`} target="_blank" rel="noopener" href={kaigoPageUrl(p, forms)}>
                {o.kaigoPages && o.kaigoPages.length > 1 ? `介護の公表ページ（${p.service}）` : "介護の公表ページ"}
              </a>
            ))}
            {hasShogai && (
              <a className={`${act} bg-white`} target="_blank" rel="noopener" href={WAM_SEARCH_URL} onClick={copyName}>
                障害の公表ページを探す
              </a>
            )}
          </div>
          {hasShogai && (
            <p className="text-[11px] leading-relaxed text-muted">
              {nameCopied
                ? "事業所名をコピーしました。開いた検索画面の事業所名の欄に貼り付けてください。"
                : "障害の公表ページ（WAM NET）は直接開けないため、事業所名をコピーして検索画面を開きます。"}
            </p>
          )}
        </div>
      )}
      {sameSpot > 1 && <p className="text-xs text-muted">この場所には、ほかに {sameSpot - 1} 件の事業所があります。一覧の前後を確認してください。</p>}
      {o.lat == null && <p className="text-xs text-muted">公表データに位置情報がないため、地図には出していません。</p>}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-px text-xs text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function AboutData({ data, extra }: { data: OfficeData; extra?: React.ReactNode }) {
  return (
    <section id="about-data" className="mt-5 grid gap-2.5 rounded-xl border border-rule bg-white p-4 text-[13px]">
      <h2 className="text-sm font-bold">データについて</h2>
      <p className="text-muted">
        距離の基準：{data.center.label}。ここから {data.maxKm}km 以内の事業所を収録しています（{fmtDate(data.generatedAt)} 作成）。
      </p>
      {data.sources.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                <th className="py-1.5 pr-2 font-normal">サービス</th>
                <th className="py-1.5 pr-2 text-right font-normal">件数</th>
                <th className="py-1.5 font-normal">時点・取得日</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <tr key={s.service} className="border-t border-rule align-top">
                  <td className="py-1.5 pr-2"><ServiceChip service={s.service} /></td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{s.count}</td>
                  <td className="py-1.5 text-muted">
                    {s.asOf ? `${s.asOf}・` : ""}
                    {fmtDate(s.fetchedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted">
        出典：「介護サービス情報公表システム」（厚生労働省）および「障害福祉サービス等情報公表システム」（独立行政法人福祉医療機構 WAM NET）のオープンデータから抽出・加工（CC BY 4.0）。地図：Esri（白地図）・国土地理院（淡色地図）。
        内容は公表時点のものです。最新の状況は各事業所に確認してください。
      </p>
      {extra}
    </section>
  );
}
