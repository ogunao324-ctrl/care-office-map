/**
 * 介護サービス情報公表システムの「事業所の詳細」ページ（基本情報）を読む
 *
 * オープンデータ（CSV）には職員数・利用者数・加算が入っていないので、詳細ページの表から拾う。
 * 取得は GitHub Actions（scripts/update-details.ts）が年2回、数秒おきにゆっくり行い、
 * 結果を public/data/details.json に置く。画面はそれを読むだけ。
 *
 * ページの表は「見出し（th）のあとに値（td）が並ぶ」形なので、th と td を出てくる順に並べ、
 * 見出しの言葉で場所を見つけて、そのすぐ後ろの値を読む。見出しの言葉は全角・半角の揺れがあるので
 * NFKC で寄せてから比べる（例：「１か月」と「1か月」）。
 *
 * 対象：訪問介護（110）・訪問看護（130）・居宅介護支援（430）
 */

export type KaigoCode = "110" | "130" | "430";

export type Staff = {
  /** 実人数（常勤＋非常勤） */
  head?: number;
  /** うち常勤（専従＋兼務） */
  full?: number;
  /** 常勤換算の人数 */
  fte?: number;
};

export type Detail = {
  /** 記入日（YYYY-MM-DD）。数字はこの日の前月・前年度のもの */
  asOf?: string;
  /** 事業の開始日（YYYY-MM-DD） */
  start?: string;
  /** 主な職種：訪問介護員等／看護職（保健師・看護師・准看護師）／介護支援専門員 */
  staff?: Staff;
  /** 2つめの職種：サービス提供責任者／リハビリ職（理学・作業療法士・言語聴覚士）／主任介護支援専門員 */
  sub?: Staff;
  /** 1人当たりの1か月のサービス提供時間（訪問介護・訪問看護） */
  hoursPer?: number;
  /** 介護支援専門員1人当たりの利用者数（居宅介護支援） */
  perCm?: number;
  /** 前年度の採用・退職（主な職種） */
  hired?: number;
  left?: number;
  /** 経験10年以上の人の割合（0〜1。主な職種） */
  veteran?: number;
  /** 1か月の提供時間：身体介護・生活援助（訪問介護） */
  body?: number;
  life?: number;
  /** 1か月の提供時間：訪問看護（介護保険の分） */
  nurse?: number;
  /** 介護保険の利用者数（記入日の前月）と、その前年同月 */
  users?: number;
  usersPrev?: number;
  /** 訪問看護：医療保険なども含めた利用者数 */
  usersAll?: number;
  /** 取っている加算（「あり」のもの） */
  kasan: string[];
  /** 加算の欄が読めたか（false のときは「不明」として扱う） */
  kasanListed: boolean;
  /** 加算の欄にある、加算以外の「実施している」こと（通院等乗降介助など） */
  feats: string[];
  /** 訪問看護：この1年に実施した特別な医療処置 */
  treat: string[];
};

type Cell = { k: "th" | "td"; t: string; n: string };

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return decode(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/[\s　]+/g, " ")
    .trim();
}

/** 見出しを比べるための形（全角→半角、空白なし） */
export function nk(s: string): string {
  return stripTags(s).normalize("NFKC").replace(/\s+/g, "");
}

/** 表の th / td を出てくる順に並べる。th は abbr（見出しの全文）があればそれを使う */
export function cellsOf(html: string): Cell[] {
  const out: Cell[] = [];
  // 属性の値に「<br />」が入っていることがある（abbr='利用者の人数<br />（…）'）ので、引用符の中の > では切らない
  const re = /<(th|td)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const k = m[1].toLowerCase() as "th" | "td";
    let t: string;
    if (k === "th") {
      const abbr = m[2].match(/\babbr=(["'])([\s\S]*?)\1/)?.[2] ?? "";
      t = stripTags(abbr) || stripTags(m[3]);
    } else {
      const alt = m[3].match(/<img\b[^>]*\balt=(["'])([^"']*)\1/i)?.[2] ?? "";
      t = `${alt}${stripTags(m[3])}`.trim();
    }
    out.push({ k, t, n: t.normalize("NFKC").replace(/\s+/g, "") });
  }
  return out;
}

function num(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  const m = s.normalize("NFKC").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

function dateOf(s: string | undefined): string | undefined {
  const m = s?.normalize("NFKC").match(/(\d{4})[/年.-](\d{1,2})[/月.-](\d{1,2})/);
  if (!m) return undefined;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function findTh(cells: Cell[], test: (n: string) => boolean, from = 0, to = cells.length): number {
  for (let i = Math.max(0, from); i < Math.min(to, cells.length); i++) {
    if (cells[i].k === "th" && test(cells[i].n)) return i;
  }
  return -1;
}

/** th のすぐ後ろに続く td（次の th が来るまで） */
function tdsAfter(cells: Cell[], i: number): Cell[] {
  const out: Cell[] = [];
  if (i < 0) return out;
  for (let j = i + 1; j < cells.length && cells[j].k === "td"; j++) out.push(cells[j]);
  return out;
}

function firstNum(cells: Cell[], test: (n: string) => boolean, from = 0): number | undefined {
  return num(tdsAfter(cells, findTh(cells, test, from))[0]?.t);
}

function add(a: number | undefined, b: number | undefined): number | undefined {
  return a == null ? b : b == null ? a : a + b;
}

function round(x: number | undefined, digits = 1): number | undefined {
  if (x == null || !Number.isFinite(x)) return undefined;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/**
 * 職種別の表の1行：常勤（専従・兼務）、非常勤（専従・兼務）、合計、常勤換算 の6つの値
 */
function staffRow(cells: Cell[], label: string, from: number): Staff | undefined {
  const key = label.normalize("NFKC");
  const i = findTh(cells, (n) => n === key, from);
  const v = tdsAfter(cells, i).map((c) => num(c.t));
  if (v.length < 6) return undefined;
  return { full: add(v[0], v[1]), head: v[4], fte: v[5] };
}

function sumStaff(list: (Staff | undefined)[]): Staff | undefined {
  const xs = list.filter((s): s is Staff => !!s);
  if (!xs.length) return undefined;
  return {
    head: xs.reduce<number | undefined>((s, x) => add(s, x.head), undefined),
    full: xs.reduce<number | undefined>((s, x) => add(s, x.full), undefined),
    fte: round(xs.reduce<number | undefined>((s, x) => add(s, x.fte), undefined), 2),
  };
}

/**
 * 「前年度の採用者数」「経験年数」の行の値を合計する。
 * 訪問介護は［常勤・うちサービス提供責任者・非常勤］の3列なので、2列目（内数）を足さない
 */
function colSum(code: KaigoCode, tds: Cell[]): number | undefined {
  const v = tds.map((c) => num(c.t));
  if (!v.some((x) => x != null)) return undefined;
  const use = code === "110" && v.length === 3 ? [v[0], v[2]] : v;
  return use.reduce<number>((s, x) => s + (x ?? 0), 0);
}

/** 加算の名前を短く：「※体制要件…」や「（予防を除く）」を落とし、括弧を全角に揃える */
export function cleanKasan(name: string): string {
  return name
    .replace(/[\s　]*※.*$/, "")
    .replace(/[（(]予防を?除く[）)]/g, "")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/[\s　]+/g, "")
    .trim();
}

const YES = /^(あり|有|○)$/;
const YES_NO = /^(あり|なし|有|無|○|×|-|－|―)$/;

function yesList(cells: Cell[], from: number, to: number): { listed: boolean; yes: string[] } {
  let listed = false;
  const yes: string[] = [];
  for (let i = from + 1; i < to; i++) {
    if (cells[i].k !== "th") continue;
    const v = tdsAfter(cells, i)[0]?.n ?? "";
    if (!YES_NO.test(v)) continue;
    listed = true;
    if (YES.test(v)) yes.push(cleanKasan(cells[i].t));
  }
  return { listed, yes };
}

/** 「利用者の人数」の表：見出し（要介護1〜5・合計）のあとに値が並び、続けて前年同月の値が並ぶ */
function userBlocks(cells: Cell[]): { now?: number; prev?: number }[] {
  const out: { now?: number; prev?: number }[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].k !== "th" || !cells[i].n.startsWith("利用者の人数")) continue;
    const labels: string[] = [];
    let j = i + 1;
    for (; j < cells.length && cells[j].k === "th"; j++) if (cells[j].n) labels.push(cells[j].n);
    const idx = labels.indexOf("合計");
    if (idx < 0) continue;
    const now = tdsAfter(cells, j - 1);
    let prev: Cell[] = [];
    let k = j + now.length;
    // 行をまたぐ空の見出し（rowspan の残り）を飛ばす
    while (cells[k]?.k === "th" && !cells[k].n) k++;
    if (cells[k]?.k === "th" && cells[k].n.startsWith("(前年同月")) prev = tdsAfter(cells, k);
    // 値が見出しより少ないときは後ろ（合計）から数える
    const pick = (tds: Cell[]) => num(tds.length === labels.length ? tds[idx]?.t : tds[tds.length - (labels.length - idx)]?.t);
    out.push({ now: pick(now), prev: prev.length ? pick(prev) : undefined });
    i = k;
  }
  return out;
}

export function isErrorPage(html: string): boolean {
  return /該当するページが見つかりませんでした|エラーが発生しました/.test(html) && !/記入日/.test(html);
}

/** 詳細ページ（基本情報）を読む。事業所が見つからないページなら null */
export function parseKihon(html: string, code: KaigoCode): Detail | null {
  if (isErrorPage(html)) return null;
  const cells = cellsOf(html);
  if (!cells.length) return null;
  const d: Detail = { kasan: [], kasanListed: false, feats: [], treat: [] };

  d.asOf = dateOf(html.match(/記入日[：:]\s*([0-9０-９]{4}年[0-9０-９]{1,2}月[0-9０-９]{1,2}日)/)?.[1]);
  const startTh = findTh(cells, (n) => n.startsWith("事業の開始(予定)年月日") || n === "事業開始年月日");
  d.start = dateOf(tdsAfter(cells, startTh)[0]?.t);

  // 職種別の従業者
  const st = Math.max(0, findTh(cells, (n) => n.startsWith("職種別の従業者の数")));
  if (code === "110") {
    d.staff = staffRow(cells, "訪問介護員等", st);
    d.sub = staffRow(cells, "（うちサービス提供責任者）", st);
  } else if (code === "130") {
    const from = Math.max(st, findTh(cells, (n) => n.startsWith("その従業者の数及びその勤務形態"), st));
    d.staff = sumStaff(["保健師", "看護師", "准看護師"].map((l) => staffRow(cells, l, from)));
    d.sub = sumStaff(["理学療法士", "作業療法士", "言語聴覚士"].map((l) => staffRow(cells, l, from)));
  } else {
    d.staff = staffRow(cells, "介護支援専門員", st);
    d.sub = staffRow(cells, "うち主任介護支援専門員", st);
  }

  d.hoursPer = firstNum(cells, (n) => n.includes("1人当たりの1か月のサービス提供時間数"));
  if (code === "430") d.perCm = firstNum(cells, (n) => n.startsWith("介護支援専門員1人当たりの利用者数"));

  // 採用・退職・経験年数
  const ex = findTh(cells, (n) => n.startsWith("従業者の当該報告に係る介護サービスの業務に従事した経験年数"));
  if (ex >= 0) {
    d.hired = colSum(code, tdsAfter(cells, findTh(cells, (n) => n === "前年度の採用者数", ex)));
    d.left = colSum(code, tdsAfter(cells, findTh(cells, (n) => n === "前年度の退職者数", ex)));
    const exEnd = findTh(cells, (n) => n.includes("経験年数は") || n.includes("健康診断"), ex);
    let total = 0;
    let ten = 0;
    for (let i = ex; i < (exEnd < 0 ? cells.length : exEnd); i++) {
      if (cells[i].k !== "th" || !/^\d.*の者の人数$/.test(cells[i].n)) continue;
      const v = colSum(code, tdsAfter(cells, i)) ?? 0;
      total += v;
      if (cells[i].n.startsWith("10年以上")) ten += v;
    }
    if (total > 0) d.veteran = round(ten / total, 3);
  }

  // 加算（と、同じ欄にある「実施の有無」）
  const ks = findTh(cells, (n) => n.startsWith("介護報酬の加算状況"));
  if (ks >= 0) {
    const ke = findTh(
      cells,
      (n) =>
        n.includes("提供実績") ||
        n.startsWith("特別な医療処置") ||
        n.includes("1人当たりの利用者数") ||
        n.includes("苦情") ||
        n.startsWith("利用者の人数"),
      ks + 1,
    );
    const r = yesList(cells, ks, ke < 0 ? cells.length : ke);
    d.kasanListed = r.listed;
    d.kasan = r.yes.filter((x) => x.includes("加算"));
    d.feats = r.yes.filter((x) => !x.includes("加算")).map((x) => x.replace(/の実施$/, ""));
  }
  if (code === "130") {
    const ts = findTh(cells, (n) => n.startsWith("特別な医療処置等の実施状況"));
    if (ts >= 0) {
      const te = findTh(cells, (n) => n.includes("提供実績"), ts + 1);
      d.treat = yesList(cells, ts, te < 0 ? cells.length : te).yes.filter((x) => x !== "その他");
    }
  }

  // 提供実績
  if (code === "110") {
    d.body = firstNum(cells, (n) => n.startsWith("身体介護中心型の1か月の提供時間"));
    d.life = firstNum(cells, (n) => n.startsWith("生活援助中心型の1か月の提供時間"));
  }
  if (code === "130") {
    d.nurse = firstNum(cells, (n) => n.startsWith("訪問看護の1か月の提供時間"));
    const all = findTh(cells, (n) => n.includes("介護保険適用以外の利用者も含む"));
    if (all >= 0) d.usersAll = firstNum(cells, (n) => n === "合計", all);
  }
  const blocks = userBlocks(cells);
  if (blocks.length) {
    d.users = blocks.reduce<number | undefined>((s, b) => add(s, b.now), undefined);
    if (blocks.every((b) => b.prev != null)) d.usersPrev = blocks.reduce((s, b) => s + (b.prev ?? 0), 0);
  }
  return d;
}

// ---------------------------------------------------------------------------
// 画面で使うもの

export type DetailRecord = Detail & { /** 取得した日（YYYY-MM-DD） */ fetched: string };

export type DetailsData = {
  generatedAt: string;
  source: { name: string; url: string };
  /** キーは detailKey（事業所番号-サービス番号） */
  details: Record<string, DetailRecord>;
};

export function detailKey(number: string, code: string): string {
  return `${String(number).replace(/\D/g, "")}-${code}`;
}

/** 記入日が古い（これより前の年数）ものは「古い」として目立たせない */
export const STALE_YEARS = 2;

export function yearsSince(date: string | undefined, now: Date): number | null {
  if (!date) return null;
  const t = Date.parse(`${date}T00:00:00+09:00`);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / (365.25 * 24 * 3600 * 1000);
}

export function isStale(d: Detail, now: Date): boolean {
  const y = yearsSince(d.asOf, now);
  return y == null || y > STALE_YEARS;
}

/** 特定事業所加算の区分（Ⅰ〜Ⅴ・Ａ）。取っていなければ空 */
export function tokuteiOf(d: Detail): string[] {
  return d.kasan.map((k) => k.match(/^特定事業所加算（(.+?)）$/)?.[1]).filter((x): x is string => !!x);
}

/** 体制比較で並べ替えに使う数字 */
export type MetricId = "users" | "growth" | "staff" | "fte" | "hours" | "start";

export const METRIC_LABEL: Record<MetricId, string> = {
  users: "利用者数",
  growth: "利用者の増減（前年同月比）",
  staff: "職員数",
  fte: "常勤換算",
  hours: "1か月の提供時間",
  start: "開設が新しい順",
};

/** 訪問看護は医療保険の利用者も多いので、あればそちらを含めた数を使う */
export function usersOf(d: Detail): number | undefined {
  return d.usersAll ?? d.users;
}

export function metricOf(d: Detail, m: MetricId): number | undefined {
  switch (m) {
    case "users":
      return usersOf(d);
    case "growth":
      return d.users != null && d.usersPrev != null ? d.users - d.usersPrev : undefined;
    case "staff":
      return d.staff?.head;
    case "fte":
      return d.staff?.fte;
    case "hours":
      return d.body != null || d.life != null ? (d.body ?? 0) + (d.life ?? 0) : d.nurse;
    case "start":
      return d.start ? Date.parse(d.start) : undefined;
  }
}

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const h = Math.floor(v.length / 2);
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

/** 加算ごとに、取っている事業所の数（多い順） */
export function kasanShares(list: Detail[]): { name: string; count: number; of: number }[] {
  const listed = list.filter((d) => d.kasanListed);
  const counts = new Map<string, number>();
  for (const d of listed) for (const k of new Set(d.kasan)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count, of: listed.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
}

// ---------------------------------------------------------------------------
// 体制比較：事業所と詳細を結びつけ、範囲の中で比べる

export type CompareCat = "hh" | "vn";

export const COMPARE_CATS: { id: CompareCat; code: KaigoCode; name: string; staff: string; sub: string }[] = [
  { id: "hh", code: "110", name: "訪問介護", staff: "訪問介護員", sub: "サービス提供責任者" },
  { id: "vn", code: "130", name: "訪問看護", staff: "看護職員", sub: "リハビリ職" },
];

export function compareCatOf(code: string): (typeof COMPARE_CATS)[number] | undefined {
  return COMPARE_CATS.find((c) => c.code === code);
}

/** そのサービスで並べ替えに使える数字 */
export function metricsFor(code: KaigoCode): MetricId[] {
  return code === "110" ? ["users", "growth", "staff", "fte", "hours", "start"] : ["users", "growth", "staff", "fte", "start"];
}

type WithPages = { kaigoPages?: { code: string; number: string }[] };

/** その事業所の、そのサービスの詳細（事業所番号が複数あるときは取れている方） */
export function detailOf(o: WithPages, code: KaigoCode, details: Record<string, DetailRecord> | null | undefined): { key: string; d: DetailRecord } | null {
  if (!details) return null;
  for (const p of o.kaigoPages ?? []) {
    if (p.code !== code) continue;
    const key = detailKey(p.number, code);
    if (details[key]) return { key, d: details[key] };
  }
  return null;
}

/** 大きい順で何位か（同じ値は同じ順位） */
export function rankOf(values: number[], v: number): number {
  return values.filter((x) => x > v).length + 1;
}

/** 「はい」の項目ごとに、何か所が当てはまるか（医療処置など） */
export function yesShares(list: Detail[], pick: (d: Detail) => string[]): { name: string; count: number; of: number }[] {
  const counts = new Map<string, number>();
  for (const d of list) for (const k of new Set(pick(d))) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count, of: list.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
}
