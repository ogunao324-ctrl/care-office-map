/**
 * 過去の公表データから「競合の動き」の履歴を作る → public/data/history.json
 *
 *   npm run history
 *
 * 1. 厚労省（介護：訪問介護・訪問看護・居宅介護支援）と WAM NET（障害：居宅介護・重度訪問介護・
 *    行動援護・同行援護・計画相談支援・障害児相談支援）のページから、全時点のファイルを拾う
 * 2. まだ取っていない時点だけダウンロードし、自社から MAX_KM+1 km 以内の事業所を
 *    data/history/<介護|障害>-<年月>-<番号>.json に保存する（取った時点は二度と取らない）
 * 3. 保存済みの全時点を合わせて、事業所ごとに「どの時点に載っていたか」を history.json に書く
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FALLBACK_CENTER, HOME_PREF, HOME_WARD, MAX_KM } from "../src/config";
import type { HistoryData, HistoryOffice, HistorySource } from "../src/lib/history";
import { distanceKm, normAddr, type OfficeData } from "../src/lib/offices";
import { decodeText, isOtherPrefecture, parseOpenData } from "../src/lib/opendata";
import { download, expand, fetchText } from "./net";
import { findAllMhlwLinks, findAllWamLinks, MHLW_PAGE, WAM_PAGE, type HistoryLink } from "./sources";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "data", "history");
const OUT = join(ROOT, "public", "data", "history.json");
const OFFICES = join(ROOT, "public", "data", "offices.json");

const KAIGO_CODES = ["110", "130", "430"] as const;
const SHOGAI_CODES = ["11", "12", "13", "15", "52", "70"] as const;

type Snapshot = {
  src: HistorySource;
  ym: string;
  code: string;
  url: string;
  rows: { no: string; s: string; n: string; a: string; la: number | null; lo: number | null }[];
};

const fileOf = (src: HistorySource, ym: string, code: string) => join(DIR, `${src}-${ym}-${code}.json`);

async function center() {
  try {
    const d = JSON.parse(await readFile(OFFICES, "utf8")) as OfficeData;
    return { lat: d.center.lat, lng: d.center.lng };
  } catch {
    return FALLBACK_CENTER;
  }
}

async function fetchSnapshot(src: HistorySource, link: HistoryLink): Promise<Snapshot> {
  const bytes = await download(link.url);
  const rows: Snapshot["rows"] = [];
  for (const part of await expand({ name: link.url.split("/").pop() ?? "", bytes, url: link.url })) {
    const res = parseOpenData(decodeText(part.bytes), part.name, {
      center: FALLBACK_CENTER,
      maxKm: MAX_KM + 1,
      homeWard: HOME_WARD,
      homePref: HOME_PREF,
    });
    for (const r of res.rows) {
      // 事業所番号が無い古い行は、名前と住所で代わりの番号を作る
      const no = r.number.replace(/\D/g, "") || `x:${r.name}:${normAddr(r.address)}`;
      rows.push({ no, s: r.service, n: r.name, a: r.address, la: r.lat, lo: r.lng });
    }
  }
  return { src, ym: link.ym, code: link.code, url: link.url, rows };
}

async function collect(): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const jobs: { src: HistorySource; link: HistoryLink }[] = [];
  try {
    const links = findAllMhlwLinks(await fetchText(MHLW_PAGE), KAIGO_CODES);
    console.log(`厚労省: ${links.length} ファイル（${[...new Set(links.map((l) => l.ym))].join("、")}）`);
    jobs.push(...links.map((link) => ({ src: "kaigo" as const, link })));
  } catch (e) {
    console.warn(`厚労省のページを読めませんでした: ${String(e)}`);
  }
  try {
    const links = findAllWamLinks(await fetchText(WAM_PAGE), SHOGAI_CODES);
    console.log(`WAM NET: ${links.length} ファイル（${[...new Set(links.map((l) => l.ym))].join("、")}）`);
    jobs.push(...links.map((link) => ({ src: "shogai" as const, link })));
  } catch (e) {
    console.warn(`WAM NET のページを読めませんでした: ${String(e)}`);
  }
  for (const { src, link } of jobs) {
    const path = fileOf(src, link.ym, link.code);
    if (existsSync(path)) continue;
    try {
      const snap = await fetchSnapshot(src, link);
      await writeFile(path, JSON.stringify(snap) + "\n");
      console.log(`  保存: ${src} ${link.ym} ${link.code} → ${snap.rows.length} 件`);
    } catch (e) {
      console.warn(`  取得できませんでした: ${src} ${link.ym} ${link.code} ${String(e)}`);
    }
  }
}

async function build(): Promise<HistoryData> {
  const c = await center();
  const names = (await readdir(DIR).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  const snaps: Snapshot[] = [];
  for (const n of names) snaps.push(JSON.parse(await readFile(join(DIR, n), "utf8")));

  const snapshots: Record<HistorySource, string[]> = { kaigo: [], shogai: [] };
  for (const src of ["kaigo", "shogai"] as HistorySource[]) {
    // その出どころの全サービスがそろっている時点だけ使う（一部だけ取れた時点は誤って「なくなった」に見える）
    const codes = src === "kaigo" ? KAIGO_CODES : SHOGAI_CODES;
    const yms = [...new Set(snaps.filter((s) => s.src === src).map((s) => s.ym))].sort();
    snapshots[src] = yms.filter((ym) => codes.every((code) => snaps.some((s) => s.src === src && s.ym === ym && s.code === code)));
  }

  const map = new Map<string, HistoryOffice>();
  for (const snap of snaps) {
    const idx = snapshots[snap.src].indexOf(snap.ym);
    if (idx < 0) continue;
    const len = snapshots[snap.src].length;
    for (const r of snap.rows) {
      if (r.la != null && r.lo != null && distanceKm(c, { lat: r.la, lng: r.lo }) > MAX_KM) continue;
      // 取得済みの古い時点のファイルには、他県の住所で位置だけ近い行が残っている
      if (isOtherPrefecture(r.a, HOME_PREF)) continue;
      const key = `${snap.src}|${r.s}|${r.no}`;
      let o = map.get(key);
      if (!o) {
        o = { src: snap.src, s: r.s, no: r.no, n: r.n, a: r.a, la: r.la, lo: r.lo, p: "0".repeat(len) };
        map.set(key, o);
      }
      o.p = o.p.slice(0, idx) + "1" + o.p.slice(idx + 1);
      // 名前・住所・位置は新しい時点のものを使う（ファイル名順＝時点の古い順に読んでいる）
      o.n = r.n;
      o.a = r.a;
      if (r.la != null) {
        o.la = r.la;
        o.lo = r.lo;
      }
    }
  }
  const offices = [...map.values()].filter((o) => o.p.includes("1"));
  console.log(
    `history.json: 介護 ${snapshots.kaigo.length} 時点（${snapshots.kaigo[0] ?? "-"}〜）、障害 ${snapshots.shogai.length} 時点（${snapshots.shogai[0] ?? "-"}〜）、${offices.length} 件`,
  );
  return { generatedAt: new Date().toISOString(), snapshots, offices };
}

async function main() {
  if (!process.argv.includes("--rebuild")) await collect();
  const data = await build();
  await writeFile(OUT, JSON.stringify(data) + "\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
