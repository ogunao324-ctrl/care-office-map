/**
 * 介護の事業所の「詳細」ページ（介護サービス情報公表システム）から、職員・利用者・加算を取る
 *
 * 対象：offices.json にある訪問介護・訪問看護（自社から 10km 以内、約 550 ページ）
 * 取り方：1ページずつ、数秒おきにゆっくり。年2回（GitHub Actions）。
 *         取ったものは data/details/ に1件1ファイルで残し、150日たつまでは取り直さない。
 *         時間の上限を過ぎたらそこで区切り、続きは次の実行で取る。
 * 出力　：public/data/details.json（画面が読む）
 *
 * 利用について：介護サービス情報公表システムの「リンク・転載等について」に沿い、
 * 画面には出所を明記し、自社の経営の分析にだけ使う（2026-10-14 にユーザーと確認）。
 *
 *   npm run details                  # 足りない分・古い分を取りに行く
 *   npm run details -- --limit 20    # 取りに行く件数の上限（試し用）
 *   npm run details -- --minutes 90  # この時間を過ぎたら区切る
 *   npm run details -- --refetch     # 全部取り直す（読み取りを直したとき）
 *   npm run details -- --rebuild     # 取りに行かず、data/details/ から details.json だけ作り直す
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detailKey, parseKihon, type Detail, type DetailRecord, type DetailsData, type KaigoCode } from "../src/lib/details";
import { kaigoPageUrl, type OfficeData } from "../src/lib/offices";
import { HOME_PREF } from "../src/config";
import { decodeText, isOtherPrefecture } from "../src/lib/opendata";

const ROOT = join(import.meta.dirname, "..");
const OFFICES = join(ROOT, "public/data/offices.json");
const DIR = join(ROOT, "data/details");
const OUT = join(ROOT, "public/data/details.json");

/** 取得元に分かるように、何のための取得かを名乗る（ヘッダーは ASCII のみ） */
const UA = "Mozilla/5.0 (compatible; care-office-map/1.0; small business analysis; twice a year, one page every few seconds)";
/** 1ページごとの間隔 */
const WAIT_MS = 2500;
/** これより前に取ったものは取り直す（年2回の実行で毎回1度ずつ取り直す間隔） */
const MAX_AGE_DAYS = 150;
/** 続けてこの回数失敗したら、相手に負担をかけないよう止める */
const MAX_FAILS = 6;

/** 居宅介護支援（430）は画面で使わないので取らない（2026-10-14、ユーザーの指示） */
const CODES: KaigoCode[] = ["110", "130"];

type Target = { key: string; number: string; code: KaigoCode; url: string; name: string };
type CacheFile = { key: string; fetched: string; status: "ok" | "notfound"; detail?: Detail };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

async function targets(): Promise<Target[]> {
  const d = JSON.parse(await readFile(OFFICES, "utf8")) as OfficeData;
  const forms = d.kaigoDetailForms ?? {};
  const map = new Map<string, Target>();
  for (const o of d.offices) {
    // 他県の住所なのに位置だけ近い事業所（公表データの位置の付け間違い）は対象にしない
    if (isOtherPrefecture(o.address, HOME_PREF)) continue;
    for (const p of o.kaigoPages ?? []) {
      const code = p.code as KaigoCode;
      if (!CODES.includes(code) || !forms[code] || !/^\d{10}$/.test(p.number)) continue;
      const key = detailKey(p.number, code);
      if (!map.has(key)) map.set(key, { key, number: p.number, code, url: kaigoPageUrl(p, forms), name: o.name });
    }
  }
  return [...map.values()];
}

async function readCache(key: string): Promise<CacheFile | null> {
  try {
    return JSON.parse(await readFile(join(DIR, `${key}.json`), "utf8")) as CacheFile;
  } catch {
    return null;
  }
}

function ageDays(date: string): number {
  return (Date.now() - Date.parse(`${date}T00:00:00+09:00`)) / 86400000;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return decodeText(new Uint8Array(await res.arrayBuffer()));
}

async function collect(list: Target[]): Promise<void> {
  const refetch = process.argv.includes("--refetch");
  const limit = Number(arg("--limit") ?? Infinity);
  const minutes = Number(arg("--minutes") ?? 110);
  const deadline = Date.now() + minutes * 60000;

  const due: { t: Target; age: number }[] = [];
  for (const t of list) {
    const c = await readCache(t.key);
    const age = c ? ageDays(c.fetched) : Infinity;
    if (refetch || age > MAX_AGE_DAYS) due.push({ t, age });
  }
  // まだ取ったことのないもの → 古いものの順
  due.sort((a, b) => b.age - a.age);
  console.log(`対象 ${list.length} ページのうち、取りに行くのは ${due.length} ページ（上限 ${Number.isFinite(limit) ? limit : "なし"}・${minutes}分まで）`);

  await mkdir(DIR, { recursive: true });
  let done = 0;
  let fails = 0;
  let notFound = 0;
  for (const { t } of due) {
    if (done >= limit) break;
    if (Date.now() > deadline) {
      console.log(`時間の上限に達したので区切ります（残り ${due.length - done} ページは次回）`);
      break;
    }
    try {
      const html = await fetchPage(t.url);
      const detail = parseKihon(html, t.code);
      const file: CacheFile = detail
        ? { key: t.key, fetched: today(), status: "ok", detail }
        : { key: t.key, fetched: today(), status: "notfound" };
      if (!detail) notFound++;
      await writeFile(join(DIR, `${t.key}.json`), JSON.stringify(file) + "\n");
      fails = 0;
      done++;
      if (done % 50 === 0) console.log(`  ${done} / ${due.length}`);
    } catch (e) {
      fails++;
      console.warn(`  ${t.key} ${t.name}: ${String(e)}`);
      if (fails >= MAX_FAILS) {
        console.warn(`続けて ${MAX_FAILS} 回失敗したので止めます（取れた分は保存済み）`);
        break;
      }
      await sleep(WAIT_MS * 4);
    }
    await sleep(WAIT_MS);
  }
  console.log(`取得 ${done} ページ（うち事業所が見つからないページ ${notFound}）`);
}

async function build(list: Target[]): Promise<DetailsData> {
  const keys = new Set(list.map((t) => t.key));
  const names = (await readdir(DIR).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  const details: Record<string, DetailRecord> = {};
  for (const n of names) {
    const key = n.replace(/\.json$/, "");
    if (!keys.has(key)) {
      // 対象でなくなったもの（居宅介護支援など）のキャッシュは残さない
      await rm(join(DIR, n), { force: true });
      continue;
    }
    const c = await readCache(key);
    if (c?.status === "ok" && c.detail) details[key] = { ...c.detail, fetched: c.fetched };
  }
  console.log(`details.json: ${Object.keys(details).length} / ${list.length} ページ分`);
  return {
    generatedAt: new Date().toISOString(),
    source: { name: "介護サービス情報公表システム（厚生労働省）", url: "https://www.kaigokensaku.mhlw.go.jp/" },
    details,
  };
}

async function main() {
  const list = await targets();
  if (!list.length) throw new Error("offices.json に介護の公表ページの情報がありません（先に npm run data）");
  if (!process.argv.includes("--rebuild")) await collect(list);
  const data = await build(list);
  await writeFile(OUT, JSON.stringify(data) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
