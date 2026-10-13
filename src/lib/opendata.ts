/**
 * 公表データ（CSV）の読み取りと、事業所ごとのまとめ
 *
 * 読む表は2種類。列名で探すので、列の順番が変わっても読める。
 *  - 介護サービス情報公表システム（厚労省）… 事業所名 / 住所 / 方書 / 緯度 / 経度 / 電話番号 …
 *    サービスの列が無い年もあるので、その場合はファイル名（jigyosho_110 など）から決める
 *  - 障害福祉サービス等情報公表システム（WAM NET）… 事業所の名称 / 事業所住所（市区町村）/
 *    事業所住所（番地以降）/ 事業所緯度 / 事業所経度 / サービス種別 / 定休日 …
 *
 * 文字コードは UTF-8 が基本。読めなければ Shift_JIS として読み直す。
 * 「（改行）」はセル内の改行を置き換えた印なので、空白に戻す。
 */

import { searchKey } from "./search-text";
import {
  categoryOf,
  CATEGORY_ORDER,
  digitsOnly,
  distanceKm,
  normAddr,
  type CategoryId,
  type LatLng,
  type Office,
} from "./offices";

/** 1件の指定（サービスごとの行） */
export type OpenDataRow = {
  service: string;
  name: string;
  kana: string;
  corp: string;
  address: string;
  tel: string;
  fax: string;
  url: string;
  lat: number | null;
  lng: number | null;
  number: string;
  capacity: string;
  days: string;
};

export type ParseResult = {
  rows: OpenDataRow[];
  /** 表の全行数 */
  total: number;
  /** 位置情報が無く、区の住所で残した件数 */
  noLocation: number;
  /** 緯度の列があったか */
  hasLatColumn: boolean;
};

/** ファイル名の番号 → サービス名（厚労省のファイル名 jigyosho_110_... の 110） */
const SERVICE_BY_CODE: Record<string, string> = {
  "110": "訪問介護",
  "120": "訪問入浴介護",
  "130": "訪問看護",
  "430": "居宅介護支援",
  "710": "夜間対応型訪問介護",
  "760": "定期巡回・随時対応型訪問介護看護",
};

export function serviceFromFileName(name: string): string | null {
  const m = /jigyosho_(\d{3})/.exec(name);
  return m ? SERVICE_BY_CODE[m[1]] ?? null : null;
}

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

/** ダブルクォート・セル内改行に対応した CSV の読み取り。1行ずつ onRow に渡す */
export function parseCSV(text: string, onRow: (row: string[]) => void): void {
  const n = text.length;
  let i = 0;
  let field = "";
  let row: string[] = [];
  let inQuote = false;
  let start = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (inQuote) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          field += text.slice(start, i + 1);
          i += 2;
          start = i;
          continue;
        }
        field += text.slice(start, i);
        inQuote = false;
        i++;
        start = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === 34) {
      field += text.slice(start, i);
      inQuote = true;
      i++;
      start = i;
      continue;
    }
    if (c === 44) {
      row.push(field + text.slice(start, i));
      field = "";
      i++;
      start = i;
      continue;
    }
    if (c === 10 || c === 13) {
      row.push(field + text.slice(start, i));
      field = "";
      onRow(row);
      row = [];
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      i++;
      start = i;
      continue;
    }
    i++;
  }
  const last = field + text.slice(start, i);
  if (last !== "" || row.length) {
    row.push(last);
    onRow(row);
  }
}

const KANA = /かな|カナ|ふりがな|フリガナ/;
type Test = (h: string) => boolean;

function findColumn(headers: string[], tests: Test[]): number {
  for (const t of tests) {
    const k = headers.findIndex(t);
    if (k >= 0) return k;
  }
  return -1;
}

export function mapHeader(headers: string[]) {
  const H = headers;
  return {
    name: findColumn(H, [
      (h) => h === "事業所の名称" || h === "事業所名" || h === "事業所名称",
      (h) => h.includes("事業所") && h.includes("名") && !KANA.test(h) && !h.includes("番号"),
      (h) => h === "名称",
    ]),
    kana: findColumn(H, [(h) => h.includes("事業所") && KANA.test(h), (h) => /^名称.?(カナ|かな)/.test(h)]),
    service: findColumn(H, [(h) => /サービス(の)?種(別|類)/.test(h), (h) => h === "実施サービス"]),
    addrCity: findColumn(H, [(h) => h.includes("事業所住所") && h.includes("市区町村")]),
    addrRest: findColumn(H, [(h) => h.includes("事業所住所") && h.includes("番地")]),
    addr: findColumn(H, [
      (h) => h === "住所" || h === "所在地" || h === "事業所住所",
      (h) => h.includes("住所") && !h.includes("法人"),
    ]),
    building: findColumn(H, [(h) => h.startsWith("方書")]),
    city: findColumn(H, [(h) => h === "市区町村名"]),
    pref: findColumn(H, [(h) => h === "都道府県名"]),
    lat: findColumn(H, [(h) => h === "事業所緯度", (h) => h.includes("緯度") && !h.includes("法人")]),
    lng: findColumn(H, [(h) => h === "事業所経度", (h) => h.includes("経度") && !h.includes("法人")]),
    tel: findColumn(H, [
      (h) => h === "事業所電話番号" || h === "電話番号",
      (h) => h.includes("電話") && !h.includes("法人"),
    ]),
    fax: findColumn(H, [
      (h) => h === "事業所FAX番号" || h === "FAX番号",
      (h) => /fax|ファクス|ファックス/i.test(h) && !h.includes("法人"),
    ]),
    corp: findColumn(H, [
      (h) => h === "法人の名称" || h === "法人名",
      (h) => h.includes("法人") && h.includes("名") && !KANA.test(h) && !h.includes("番号"),
    ]),
    number: findColumn(H, [(h) => h === "事業所番号", (h) => h === "NO" || h === "No"]),
    url: findColumn(H, [(h) => h === "事業所URL" || h === "URL", (h) => /url/i.test(h) && !h.includes("法人")]),
    capacity: findColumn(H, [(h) => h === "定員"]),
    days: findColumn(H, [(h) => h === "利用可能曜日"]),
    closed: findColumn(H, [(h) => h === "定休日"]),
  };
}

export type ParseOptions = {
  center: LatLng;
  maxKm: number;
  /** 位置情報が無い行を残す区（例：千葉市花見川区） */
  homeWard: string;
};

/**
 * 1つの CSV を読み、自社から maxKm 以内の行だけを返す。
 * 事業所名・位置の列が見つからない表はエラーにする（別の表を間違えて読んだとき用）。
 */
export function parseOpenData(text: string, fileName: string, opt: ParseOptions): ParseResult {
  const fallbackService = serviceFromFileName(fileName);
  let headers: string[] | null = null;
  let col: ReturnType<typeof mapHeader> | null = null;
  let total = 0;
  let noLocation = 0;
  const rows: OpenDataRow[] = [];
  const cell = (r: string[], i: number) =>
    i >= 0 && r[i] != null ? String(r[i]).replace(/（改行）|\(改行\)/g, " ").trim() : "";

  parseCSV(text, (r) => {
    if (!headers) {
      headers = r.map((h) => String(h).replace(/^﻿/, "").normalize("NFKC").replace(/\s/g, ""));
      col = mapHeader(headers);
      return;
    }
    if (!col || r.length < 3) return;
    total++;
    let lat = parseFloat(cell(r, col.lat));
    let lng = parseFloat(cell(r, col.lng));
    // 緯度と経度が入れ替わっている行の救済
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat > 100 && lng < 60) [lat, lng] = [lng, lat];
    const hasLoc =
      Number.isFinite(lat) && Number.isFinite(lng) && lat > 20 && lat < 50 && lng > 120 && lng < 155;

    let address = col.addrCity >= 0 ? cell(r, col.addrCity) + cell(r, col.addrRest) : cell(r, col.addr);
    // 方書（建物名）は住所の列にすでに入っていることがある。二重に付けない
    const building = col.addrCity >= 0 ? "" : cell(r, col.building);
    if (building && !normAddr(address).includes(normAddr(building))) address += ` ${building}`;
    const city = cell(r, col.city);
    const pref = cell(r, col.pref);
    if (city && !address.includes(city)) address = city + address;
    if (pref && !address.startsWith(pref)) address = pref + address;

    if (hasLoc) {
      if (distanceKm(opt.center, { lat, lng }) > opt.maxKm) return;
    } else {
      if (!address.includes(opt.homeWard)) return;
      noLocation++;
    }

    const name = cell(r, col.name);
    if (!name) return;
    const days = cell(r, col.days);
    const closed = cell(r, col.closed);
    rows.push({
      service: cell(r, col.service) || fallbackService || "サービス種別不明",
      name,
      kana: cell(r, col.kana),
      corp: cell(r, col.corp),
      address,
      tel: cell(r, col.tel),
      fax: cell(r, col.fax),
      url: cell(r, col.url),
      lat: hasLoc ? Number(lat.toFixed(6)) : null,
      lng: hasLoc ? Number(lng.toFixed(6)) : null,
      number: cell(r, col.number),
      capacity: cell(r, col.capacity),
      days: days ? `利用可能：${days}` : closed ? `定休日：${closed}` : "",
    });
  });

  const c = col as ReturnType<typeof mapHeader> | null;
  if (!c || c.name < 0 || (c.lat < 0 && c.addr < 0 && c.addrCity < 0)) {
    throw new Error(`${fileName}: 事業所名や位置の列が見つからず、事業所一覧の形式として読めませんでした`);
  }
  return { rows, total, noLocation, hasLatColumn: c.lat >= 0 };
}

function nameKey(s: string): string {
  return searchKey(s).replace(/[\s・\-ー()「」]/g, "");
}

/**
 * サービスごとの行を、事業所ごとにまとめる。
 * 同じ名前で、300m以内（位置が無ければ同じ電話番号か同じ住所）なら同じ事業所とみなす。
 * 介護と障害は別のシステムで位置を付けているので、同じ事業所でも少しずれる。
 */
export function mergeOffices(rows: OpenDataRow[], selfAddressKey: string): Office[] {
  const buckets = new Map<string, Office[]>();
  const list: Office[] = [];
  for (const r of rows) {
    const key = nameKey(r.name);
    const bucket = buckets.get(key) ?? [];
    buckets.set(key, bucket);
    let hit: Office | undefined;
    for (const o of bucket) {
      if (o.lat != null && o.lng != null && r.lat != null && r.lng != null) {
        if (distanceKm({ lat: o.lat, lng: o.lng }, { lat: r.lat, lng: r.lng }) < 0.3) {
          hit = o;
          break;
        }
      } else if (digitsOnly(o.tel) && digitsOnly(o.tel) === digitsOnly(r.tel)) {
        hit = o;
        break;
      } else if (normAddr(o.address) === normAddr(r.address)) {
        hit = o;
        break;
      }
    }
    if (!hit) {
      hit = {
        id: "",
        name: r.name,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        numbers: [],
        services: [],
        categories: [],
        capacity: [],
      };
      bucket.push(hit);
      list.push(hit);
    }
    if (!hit.kana && r.kana) hit.kana = r.kana;
    if (!hit.corp && r.corp) hit.corp = r.corp;
    if (!hit.tel && r.tel) hit.tel = r.tel;
    if (!hit.fax && r.fax) hit.fax = r.fax;
    if (!hit.url && r.url) hit.url = r.url;
    if (!hit.days && r.days) hit.days = r.days;
    if (hit.lat == null && r.lat != null) {
      hit.lat = r.lat;
      hit.lng = r.lng;
    }
    if (r.number && !hit.numbers.includes(r.number)) hit.numbers.push(r.number);
    // 訪問系は定員が無いので「0」で入っていることが多い。意味が無いので出さない
    if (r.capacity && r.capacity !== "0") hit.capacity.push(`${r.service} ${r.capacity}人`);
    if (!hit.services.includes(r.service)) hit.services.push(r.service);
    const cat = categoryOf(r.service);
    if (!hit.categories.includes(cat)) hit.categories.push(cat);
  }
  const rank = (c: CategoryId) => CATEGORY_ORDER.indexOf(c);
  list.forEach((o, i) => {
    o.id = `o${i}`;
    o.self = normAddr(o.address).includes(selfAddressKey) || undefined;
    o.categories.sort((a, b) => rank(a) - rank(b));
    o.services.sort((a, b) => rank(categoryOf(a)) - rank(categoryOf(b)));
  });
  return list;
}

/** 行の中から自社（住所が一致し、位置のあるもの）を探す */
export function findSelf(rows: OpenDataRow[], selfAddressKey: string): OpenDataRow | null {
  return rows.find((r) => r.lat != null && normAddr(r.address).includes(selfAddressKey)) ?? null;
}
