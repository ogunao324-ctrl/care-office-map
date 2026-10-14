/**
 * 公表ページ（事業所の詳細）から読み取った体制：職員・利用者・提供時間・加算
 * 「さがす」の詳細と「体制比較」の両方で使う
 */

import { compareCatOf, isStale, tokuteiOf, usersOf, type DetailRecord, type KaigoCode, type Staff } from "@/lib/details";

export function fmtNum(n: number | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

export function ymText(date: string | undefined): string {
  const m = date?.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}年${Number(m[2])}月` : "—";
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0";
}

function staffText(s: Staff | undefined): string {
  if (!s || s.head == null) return "—";
  const parts = [];
  if (s.full != null) parts.push(`常勤${fmtNum(s.full)}`);
  if (s.fte != null) parts.push(`常勤換算${fmtNum(s.fte, 1)}`);
  return `${fmtNum(s.head)}人${parts.length ? `（${parts.join("・")}）` : ""}`;
}

/** 記入日が古いときの印 */
export function StaleBadge({ d, now }: { d: DetailRecord; now: Date }) {
  if (!isStale(d, now)) return null;
  return <span className="rounded bg-[#f1e9dc] px-1.5 text-[11px] font-bold leading-relaxed text-[#7a4b12]">古い記入</span>;
}

/** 特定事業所加算の印（取っていれば区分を出す） */
export function TokuteiBadge({ d }: { d: DetailRecord }) {
  const t = tokuteiOf(d);
  if (!t.length) return null;
  return <span className="rounded bg-ink px-1.5 text-[11px] font-bold leading-relaxed text-white">特定事業所加算{t.join("・")}</span>;
}

export function DetailFacts({
  d,
  code,
  now,
  ranks,
}: {
  d: DetailRecord;
  code: KaigoCode;
  now: Date;
  /** 範囲内での順位（例：利用者数 5位 / 40か所） */
  ranks?: { scope: string; items: { label: string; rank: number; of: number }[] } | null;
}) {
  const cat = compareCatOf(code);
  const users = usersOf(d);
  const growth = d.users != null && d.usersPrev != null ? d.users - d.usersPrev : null;
  return (
    <div className="grid gap-1.5 text-[13px]">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-xs text-muted">利用者</dt>
        <dd className="tabular-nums">
          <b>{fmtNum(users)}人</b>
          {code === "130" && d.usersAll != null && <span className="text-muted">（医療保険も含む。介護保険は{fmtNum(d.users)}人）</span>}
          {growth != null && (
            <span className="text-muted">
              {" "}
              前年同月{code === "130" ? "（介護保険）" : ""} {fmtNum(d.usersPrev)}人・<b className="text-ink">{signed(growth)}</b>
            </span>
          )}
        </dd>
        <dt className="text-xs text-muted">{cat?.staff ?? "職員"}</dt>
        <dd className="tabular-nums">{staffText(d.staff)}</dd>
        {d.sub?.head != null && (
          <>
            <dt className="text-xs text-muted">{cat?.sub}</dt>
            <dd className="tabular-nums">{fmtNum(d.sub.head)}人</dd>
          </>
        )}
        {code === "110" && (d.body != null || d.life != null) && (
          <>
            <dt className="text-xs text-muted">1か月の提供</dt>
            <dd className="tabular-nums">
              身体 {fmtNum(d.body)}時間・生活 {fmtNum(d.life)}時間
            </dd>
          </>
        )}
        {code === "130" && d.nurse != null && (
          <>
            <dt className="text-xs text-muted">1か月の提供</dt>
            <dd className="tabular-nums">{fmtNum(d.nurse)}時間（介護保険の分）</dd>
          </>
        )}
        {d.hoursPer != null && code !== "430" && (
          <>
            <dt className="text-xs text-muted">1人あたり</dt>
            <dd className="tabular-nums">月 {fmtNum(d.hoursPer, 1)}時間</dd>
          </>
        )}
        {d.perCm != null && (
          <>
            <dt className="text-xs text-muted">1人あたり</dt>
            <dd className="tabular-nums">利用者 {fmtNum(d.perCm, 1)}人</dd>
          </>
        )}
        {(d.hired != null || d.left != null) && (
          <>
            <dt className="text-xs text-muted">前年度</dt>
            <dd className="tabular-nums">
              採用 {fmtNum(d.hired)}人・退職 {fmtNum(d.left)}人
            </dd>
          </>
        )}
        {d.veteran != null && (
          <>
            <dt className="text-xs text-muted">経験10年以上</dt>
            <dd className="tabular-nums">{Math.round(d.veteran * 100)}%</dd>
          </>
        )}
        {d.start && (
          <>
            <dt className="text-xs text-muted">開設</dt>
            <dd>{ymText(d.start)}</dd>
          </>
        )}
      </dl>
      {ranks && ranks.items.length > 0 && (
        <p className="text-xs leading-relaxed text-muted">
          {ranks.scope}：
          {ranks.items.map((r, i) => (
            <span key={r.label}>
              {i > 0 && "・"}
              {r.label} <b className="text-ink">{r.rank}位</b>/{r.of}か所
            </span>
          ))}
        </p>
      )}
      {d.kasanListed && (
        <div className="grid gap-1">
          <p className="text-xs text-muted">取っている加算{d.kasan.length === 0 && "：なし"}</p>
          {d.kasan.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {d.kasan.map((k) => (
                <li
                  key={k}
                  className={`rounded px-1.5 text-[11px] leading-relaxed ${k.startsWith("特定事業所") ? "bg-ink font-bold text-white" : "bg-[#eef2f1]"}`}
                >
                  {k}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {d.feats.length > 0 && <p className="text-xs text-muted">実施：{d.feats.join("・")}</p>}
      {d.treat.length > 0 && (
        <p className="text-xs leading-relaxed text-muted">
          この1年の医療処置（{d.treat.length}項目）：{d.treat.join("・")}
        </p>
      )}
      <p className="text-[11px] text-muted">
        記入日 {d.asOf ? d.asOf.replaceAll("-", "/") : "—"}
        {isStale(d, now) && "（2年以上前の記入。今とは違うかもしれません）"}
        ・出典：介護サービス情報公表システム
      </p>
    </div>
  );
}
