"use client";

/**
 * 画面全体：検索・絞り込み → 地図 → 自社から近い順の一覧
 *
 * スマホ：上に検索と絞り込み、その下に地図、残りが一覧。
 * PC（幅1024px〜）：左に一覧、右に地図。
 *
 * データは public/data/offices.json（scripts/update-data.ts が作る）を読むだけ。
 * 距離は画面側で「自社」から測り直す。
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_RADIUS, RADII } from "@/config";
import {
  CATEGORIES,
  categoryColor,
  categoryOf,
  digitsOnly,
  distanceKm,
  formatDistance,
  type CategoryId,
  type OfficeData,
} from "@/lib/offices";
import { searchKey } from "@/lib/search-text";
import type { MapOffice } from "./OfficeMap";

const OfficeMap = dynamic(() => import("./OfficeMap").then((m) => m.OfficeMap), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-xl border border-rule bg-[#e9ece6]" />,
});

const PAGE = 150;
const RADIUS_KEY = "care-office-map:radius";
const ALL_ON: Record<CategoryId, boolean> = { cm: true, hh: true, dv: true, cs: true, ot: true };

type Row = MapOffice & { key: string };

export function OfficeMapApp() {
  const [data, setData] = useState<OfficeData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<Record<CategoryId, boolean>>(ALL_ON);
  const [radius, setRadius] = useState<number>(DEFAULT_RADIUS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sameSpot, setSameSpot] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [fitToken, setFitToken] = useState(0);
  const [focus, setFocus] = useState<{ lat: number; lng: number; token: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/data/offices.json", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<OfficeData>;
      })
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
      })
      .catch((e) => alive && setLoadError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const center = data?.center ?? null;

  // 距離と検索用の文字を、データが来たときに1回だけ作る
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
    const counts: Record<CategoryId, number> = { cm: 0, hh: 0, dv: 0, cs: 0, ot: 0 };
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

  const onMapSelect = useCallback((id: string, spot: number) => select(id, spot, true), [select]);

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

  const hasData = (data?.offices.length ?? 0) > 0;

  return (
    <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-2.5 px-4 pt-2.5 lg:pt-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-wide">花見川 事業所マップ</h1>
          <p className="truncate text-xs text-muted">
            自社から{radius}km以内{data && `・${visible.length.toLocaleString("ja-JP")}件`}
          </p>
        </div>
        <a
          href="#about-data"
          className="shrink-0 rounded-full border border-rule bg-white px-3 py-1.5 text-xs font-bold text-ink"
        >
          データについて
        </a>
      </header>

      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
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
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={on ? { background: c.color } : { boxShadow: `inset 0 0 0 2px ${c.color}` }}
                />
                {c.name}
                <span className="text-[11px] tabular-nums text-muted">{counts[c.id]}</span>
              </button>
            );
          })}
        </div>

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
      </div>

      <main className="flex min-h-0 flex-1 flex-col gap-2.5 lg:flex-row">
        <div className="relative h-[42%] min-h-56 shrink-0 lg:order-2 lg:h-auto lg:flex-1">
          {center ? (
            <OfficeMap
              center={center}
              radiusKm={radius}
              offices={visible}
              activeCategories={cats}
              selectedId={selectedId}
              onSelect={onMapSelect}
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

        <section className="min-h-0 flex-1 overflow-y-auto pb-4 lg:order-1 lg:w-[400px] lg:flex-none" aria-label="事業所一覧">
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

          {data && <AboutData data={data} />}
        </section>
      </main>
    </div>
  );
}

function Note({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 grid gap-1.5 rounded-xl border border-rule bg-white p-4 text-sm">
      {title && <h2 className="font-bold">{title}</h2>}
      <p className="text-muted">{children}</p>
    </div>
  );
}

function ServiceChip({ service }: { service: string }) {
  const color = categoryColor(categoryOf(service));
  return (
    <span
      className="rounded px-1.5 text-[11px] font-bold leading-relaxed"
      style={{ color, background: `${color}1f` }}
    >
      {service}
    </span>
  );
}

function OfficeRow({
  office: o,
  open,
  sameSpot,
  center,
  onToggle,
}: {
  office: Row;
  open: boolean;
  sameSpot: number;
  center: { lat: number; lng: number } | null;
  onToggle: () => void;
}) {
  const both = o.categories.some((c) => c === "cm" || c === "hh") && o.categories.some((c) => c === "dv" || c === "cs");
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
      {open && <OfficeDetail office={o} sameSpot={sameSpot} center={center} />}
    </li>
  );
}

function OfficeDetail({ office: o, sameSpot, center }: { office: Row; sameSpot: number; center: { lat: number; lng: number } | null }) {
  const [copied, setCopied] = useState(false);
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
  const act = "inline-flex items-center rounded-lg border border-rule bg-[#eef2f1] px-2.5 py-1.5 text-[13px] font-bold text-ink";
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
        {o.url && /^https?:\/\//i.test(o.url) && (
          <a className={act} target="_blank" rel="noopener" href={o.url}>ホームページ</a>
        )}
      </div>
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

function AboutData({ data }: { data: OfficeData }) {
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
        出典：「介護サービス情報公表システム」（厚生労働省）および「障害福祉サービス等情報公表システム」（独立行政法人福祉医療機構 WAM NET）のオープンデータから抽出・加工（CC BY 4.0）。地図：国土地理院。
        内容は公表時点のものです。最新の状況は各事業所に確認してください。
      </p>
    </section>
  );
}
