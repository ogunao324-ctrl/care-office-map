/**
 * 事業所データの形と、画面・取得スクリプトの両方で使う小道具
 */

export type LatLng = { lat: number; lng: number };

/** サービスの大きな分類。地図の点の色と、絞り込みのボタンに使う */
export type CategoryId = "cm" | "hh" | "vn" | "dv" | "cs" | "ot";

export const CATEGORIES: { id: CategoryId; name: string; color: string; group: "介護" | "障害" | "" }[] = [
  { id: "cm", name: "居宅介護支援", color: "#2f56c6", group: "介護" },
  { id: "hh", name: "訪問介護", color: "#d4531a", group: "介護" },
  { id: "vn", name: "訪問看護", color: "#a87400", group: "介護" },
  { id: "dv", name: "障害 訪問系", color: "#2c8a43", group: "障害" },
  { id: "cs", name: "相談支援", color: "#9c3bb5", group: "障害" },
  { id: "ot", name: "その他", color: "#7a837f", group: "" },
];

export const CATEGORY_ORDER: CategoryId[] = ["cm", "hh", "vn", "dv", "cs", "ot"];

/** 絞り込みの初期状態（全部表示）と、件数の入れ物 */
export function categoryRecord<T>(value: T): Record<CategoryId, T> {
  return { cm: value, hh: value, vn: value, dv: value, cs: value, ot: value };
}

export function categoryColor(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.color ?? "#7a837f";
}

/**
 * サービス名 → 分類。
 * 「重度訪問介護」は「訪問介護」を含むので、障害の訪問系を先に判定する。
 * 「居宅介護支援」も「居宅介護」を含むので、いちばん先に判定する。
 */
export function categoryOf(service: string): CategoryId {
  const s = service || "";
  if (/居宅介護支援|介護予防支援/.test(s)) return "cm";
  if (/重度訪問介護|同行援護|行動援護|重度障害者等包括支援/.test(s)) return "dv";
  if (/相談支援/.test(s)) return "cs";
  // 「定期巡回・随時対応型訪問介護看護」は訪問介護の側に入れる（下の訪問介護で拾う）
  if (/訪問看護/.test(s)) return "vn";
  if (/訪問介護/.test(s)) return "hh";
  if (/居宅介護/.test(s)) return "dv";
  return "ot";
}

/** 一覧・地図に出す1事業所（同じ事業所の介護・障害の指定はまとめてある） */
export type Office = {
  id: string;
  /** 事業所名 */
  name: string;
  /** 事業所名の読み */
  kana?: string;
  /** 法人名 */
  corp?: string;
  address: string;
  tel?: string;
  fax?: string;
  url?: string;
  lat: number | null;
  lng: number | null;
  /** 事業所番号（介護・障害で別の番号のことがある） */
  numbers: string[];
  /** 提供しているサービス名（公表データの表記のまま） */
  services: string[];
  categories: CategoryId[];
  /** 定員（サービス名つき） */
  capacity: string[];
  /** 利用可能曜日 / 定休日 */
  days?: string;
  /** 自社 */
  self?: boolean;
};

export type DataSource = {
  service: string;
  category: CategoryId;
  count: number;
  /** 取得元のファイル名 */
  file: string;
  url?: string;
  /** 公表ページの見出しにある時点（例：2026年６月末時点）。分からなければ無し */
  asOf?: string;
  fetchedAt?: string;
};

export type OfficeData = {
  generatedAt: string;
  center: LatLng & { label: string; source: "data" | "fallback" };
  maxKm: number;
  sources: DataSource[];
  offices: Office[];
};

/** 住所の表記ゆれを寄せる（全角数字・各種ハイフン・「番地」「号」など） */
export function normAddr(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replace(/(\d)[‐-―−－\-ーｰ](?=\d)/g, "$1-")
    .replace(/(\d)(丁目|番地の|番地|番)(?=\d)/g, "$1-")
    .replace(/(\d)(番地|番|号)/g, "$1");
}

/** 2点間の直線距離（km） */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLng = (b.lng - a.lng) * toR;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function formatDistance(km: number | null): string {
  if (km == null) return "位置不明";
  if (km < 1) return `${Math.round((km * 1000) / 10) * 10}m`;
  return `${km.toFixed(1)}km`;
}

/**
 * 公表データの「URL」欄を、開けるホームページの URL に直す。開けないものは null。
 *
 * 事業所が手で入力した欄なので、次のような崩れ方が実際にある（2026-10 のデータで約30件）:
 *   https:www.〜 / https:/www.〜 / https//〜 / htpps://〜 / 全角の ｈｔｔｐ・．・：
 *   「URL：http://〜」 / 先頭に「:」 / http の無い「www.〜」「〜.com」
 *   メールアドレス（info@〜）… これはホームページではないので null
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  let s = String(raw ?? "")
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s/g, "")
    .replace(/^(url)?[:：]+/i, "");
  if (!s || s === "-" || /^(なし|無し|無|未定)$/.test(s)) return null;
  if (s.includes("@") && !s.includes("/")) return null;
  s = s.replace(/^h?t+p+s?(?=[:;/])/i, (m) => (/s$/i.test(m) ? "https" : "http"));
  const scheme = /^(https?)[:;]*\/*/i.exec(s);
  s = scheme ? `${scheme[1].toLowerCase()}://${s.slice(scheme[0].length)}` : `http://${s.replace(/^\/+/, "")}`;
  try {
    const u = new URL(s);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function digitsOnly(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFKC").replace(/\D/g, "");
}
