/**
 * 公表データを取り直して public/data/offices.json を作る
 *
 *   npm run data                     … 厚労省・WAM NET のページから最新ファイルを探して取る
 *   npm run data -- --file a.csv     … 手元のファイル（CSV / ZIP）を読む。複数可
 *   npm run data -- --url https://…  … URL を直接指定して取る。複数可
 *   npm run data -- --only-files     … ページを見に行かず、--file / --url だけを使う
 *   npm run data -- --rebuild        … 取得はせず、data/rows/ から offices.json だけ作り直す
 *
 * 流れ
 *  1. ファイルを集める（ZIP は中の CSV を全部読む）
 *  2. 自社から MAX_KM 以内の行だけ残し、サービスごとに data/rows/<サービス>.json に保存
 *     （介護と障害は公表時期が違うので、取れたサービスだけ入れ替える）
 *  3. data/rows/ の全サービスを合わせて、事業所ごとにまとめ、offices.json に書く
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  FALLBACK_CENTER,
  HOME_PREF,
  HOME_WARD,
  MAX_KM,
  SELF_ADDRESS_KEY,
  SELF_BUILDING_KEY,
} from "../src/config";
import {
  categoryOf,
  distanceKm,
  KAIGO_SERVICE_CODE,
  kaigoPageUrl,
  type DataSource,
  type Office,
  type OfficeData,
} from "../src/lib/offices";
import { decodeText, findSelf, isOtherPrefecture, mergeOffices, parseOpenData, type OpenDataRow } from "../src/lib/opendata";
import { download, expand, fetchText, type Input } from "./net";
import { findMhlwLinks, findWamLinks, listDataLinks, MHLW_PAGE, WAM_PAGE, type FoundLink } from "./sources";

const ROOT = join(import.meta.dirname, "..");
const ROWS_DIR = join(ROOT, "data", "rows");
const OUT = join(ROOT, "public", "data", "offices.json");

/** サービス名 → 保存ファイル名 */
const SLUG: Record<string, string> = {
  訪問介護: "kaigo-homon-kaigo",
  訪問看護: "kaigo-homon-kango",
  居宅介護支援: "kaigo-kyotaku-shien",
  居宅介護: "shogai-kyotaku-kaigo",
  重度訪問介護: "shogai-judo-homon",
  同行援護: "shogai-doko-engo",
  行動援護: "shogai-kodo-engo",
  計画相談支援: "shogai-keikaku-sodan",
  障害児相談支援: "shogai-shogaiji-sodan",
};

function slugOf(service: string): string {
  if (SLUG[service]) return SLUG[service];
  let h = 0x811c9dc5;
  for (let i = 0; i < service.length; i++) {
    h ^= service.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `other-${(h >>> 0).toString(36)}`;
}

type RowsFile = {
  service: string;
  file: string;
  url?: string;
  asOf?: string;
  fetchedAt: string;
  rows: OpenDataRow[];
};

function parseArgs(argv: string[]) {
  const files: string[] = [];
  const urls: string[] = [];
  let onlyFiles = false;
  let rebuild = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") files.push(argv[++i]);
    else if (a === "--url") urls.push(...argv[++i].split(/[\s,]+/).filter(Boolean));
    else if (a === "--only-files") onlyFiles = true;
    else if (a === "--rebuild") rebuild = true;
  }
  return { files, urls, onlyFiles, rebuild };
}

async function collectInputs(opts: ReturnType<typeof parseArgs>): Promise<Input[]> {
  const inputs: Input[] = [];
  for (const f of opts.files) inputs.push({ name: basename(f), bytes: new Uint8Array(await readFile(f)) });
  const links: FoundLink[] = opts.urls.map((u) => ({ label: basename(new URL(u).pathname), url: u }));

  if (!opts.onlyFiles && !opts.files.length) {
    try {
      const html = await fetchText(MHLW_PAGE);
      const found = findMhlwLinks(html);
      console.log(`厚労省: ${found.map((f) => `${f.label}（${f.asOf ?? "時点不明"}）`).join("、") || "見つからず"}`);
      if (!found.length) console.warn(`  ページ内のファイル: ${listDataLinks(html, MHLW_PAGE).slice(0, 10).join(" ")}`);
      links.push(...found);
    } catch (e) {
      console.warn(`厚労省のページを読めませんでした: ${String(e)}`);
    }
    try {
      const html = await fetchText(WAM_PAGE);
      const found = findWamLinks(html);
      console.log(`WAM NET: ${found.map((f) => f.label).join("、") || "見つからず"}`);
      if (found.length < 2) console.warn(`  ページ内のファイル: ${listDataLinks(html, WAM_PAGE).slice(0, 40).join(" ")}`);
      links.push(...found);
    } catch (e) {
      console.warn(`WAM NET のページを読めませんでした: ${String(e)}`);
    }
  }

  for (const l of links) {
    try {
      console.log(`取得: ${l.label} ${l.url}`);
      inputs.push({ name: basename(new URL(l.url).pathname), bytes: await download(l.url), url: l.url, asOf: l.asOf });
    } catch (e) {
      console.warn(String(e));
    }
  }
  return inputs;
}

async function saveRows(inputs: Input[]): Promise<number> {
  // 自社が見つかると中心が数十mずれるので、取り込み時は少し広めに残す
  const opt = { center: FALLBACK_CENTER, maxKm: MAX_KM + 1, homeWard: HOME_WARD, homePref: HOME_PREF };
  const byService = new Map<string, RowsFile>();
  for (const input of inputs) {
    for (const part of await expand(input)) {
      const res = parseOpenData(decodeText(part.bytes), part.name, opt);
      const svcs = new Map<string, number>();
      for (const r of res.rows) {
        const cur = byService.get(r.service) ?? {
          service: r.service,
          file: part.name,
          url: part.url,
          asOf: part.asOf,
          fetchedAt: new Date().toISOString(),
          rows: [],
        };
        cur.rows.push(r);
        byService.set(r.service, cur);
        svcs.set(r.service, (svcs.get(r.service) ?? 0) + 1);
      }
      const summary = [...svcs].map(([s, n]) => `${s} ${n}件`).join("、") || "範囲内0件";
      console.log(`  ${part.name}: 全${res.total}行 → ${summary}${res.noLocation ? `（位置なし ${res.noLocation}件）` : ""}`);
      if (!res.hasLatColumn) console.warn(`  ${part.name}: 緯度の列がありません`);
    }
  }
  await mkdir(ROWS_DIR, { recursive: true });
  for (const [service, file] of byService) {
    await writeFile(join(ROWS_DIR, `${slugOf(service)}.json`), JSON.stringify(file) + "\n");
  }
  return byService.size;
}

async function rebuild(): Promise<OfficeData> {
  const names = (await readdir(ROWS_DIR).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  const files: RowsFile[] = [];
  for (const n of names) files.push(JSON.parse(await readFile(join(ROWS_DIR, n), "utf8")));
  const all = files.flatMap((f) => f.rows);

  const self = findSelf(all, SELF_ADDRESS_KEY);
  const sameBuilding = self ? null : findSelf(all, SELF_BUILDING_KEY);
  const center = self
    ? { lat: self.lat as number, lng: self.lng as number, label: `${self.name}（公表データの位置）`, source: "data" as const }
    : sameBuilding
      ? {
          lat: sameBuilding.lat as number,
          lng: sameBuilding.lng as number,
          label: `${SELF_BUILDING_KEY}（同じ建物の${sameBuilding.name}の位置）`,
          source: "data" as const,
        }
      : { ...FALLBACK_CENTER, label: "千葉市花見川区浪花町（町の代表点）", source: "fallback" as const };

  const inRange = (r: OpenDataRow) =>
    !isOtherPrefecture(r.address, HOME_PREF) &&
    (r.lat != null && r.lng != null ? distanceKm(center, { lat: r.lat, lng: r.lng }) <= MAX_KM : r.address.includes(HOME_WARD));
  const rows = all.filter(inRange);
  const offices = mergeOffices(rows, SELF_ADDRESS_KEY);

  const sources: DataSource[] = files.map((f) => ({
    service: f.service,
    category: categoryOf(f.service),
    count: f.rows.filter(inRange).length,
    file: f.file,
    url: f.url,
    asOf: f.asOf,
    fetchedAt: f.fetchedAt,
  }));

  return { generatedAt: new Date().toISOString(), center, maxKm: MAX_KM, sources, offices };
}

/** 前回の offices.json に入っていた様式番号（取れなかったときはこれを使い続ける） */
async function previousForms(): Promise<Record<string, string>> {
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8")) as OfficeData;
    return prev.kaigoDetailForms ?? {};
  } catch {
    return {};
  }
}

/**
 * 介護サービス情報公表システムの「事業所の詳細」ページの様式番号を、サービスごとに読み取る。
 * 各サービスの事業所を1件選んで「事業所の特色」ページ（様式番号なしで開ける）を開き、
 * その中の「事業所の詳細」タブのリンク（action_kouhyou_detail_NNN_kihon）から NNN を拾う。
 * 1回の更新でサービスごとに1〜3ページしか読まない。
 */
async function findDetailForms(offices: Office[], fallback: Record<string, string>): Promise<Record<string, string>> {
  const forms: Record<string, string> = { ...fallback };
  const pages = offices.flatMap((o) => o.kaigoPages ?? []);
  for (const code of new Set(Object.values(KAIGO_SERVICE_CODE))) {
    const samples = pages.filter((p) => p.code === code).slice(0, 3);
    for (const p of samples) {
      try {
        const html = await fetchText(kaigoPageUrl(p));
        const re = new RegExp(
          `action_kouhyou_detail_(\\d{3})_kihon=true&(?:amp;)?JigyosyoCd=${p.number}-00&(?:amp;)?ServiceCd=${code}`,
        );
        const m = re.exec(html);
        if (m) {
          forms[code] = m[1];
          break;
        }
      } catch (e) {
        console.warn(`公表ページを読めませんでした（${p.service} ${p.number}）: ${String(e)}`);
      }
    }
    console.log(`公表ページの様式番号: ${code} → ${forms[code] ?? "不明（事業所の特色ページを開きます）"}`);
  }
  return forms;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.rebuild) {
    const inputs = await collectInputs(opts);
    if (!inputs.length) {
      console.error("読み込めるファイルが1つもありませんでした。offices.json は変えません。");
      process.exitCode = 1;
      return;
    }
    const n = await saveRows(inputs);
    console.log(`${n} サービス分を data/rows/ に保存しました`);
  }
  const data = await rebuild();
  const prevForms = await previousForms();
  data.kaigoDetailForms = opts.rebuild ? prevForms : await findDetailForms(data.offices, prevForms);
  await mkdir(join(ROOT, "public", "data"), { recursive: true });
  await writeFile(OUT, JSON.stringify(data) + "\n");
  console.log(
    `offices.json: ${data.offices.length} 事業所（中心: ${data.center.label}、${data.sources.length} サービス）`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
