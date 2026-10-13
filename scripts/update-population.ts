/**
 * 国勢調査（2020年）の人口を、自社の周りの 500m 四方のマスごとに作る → public/data/areas.json
 *
 *   npm run population
 *
 * 使うデータ（e-Stat「地図で見る統計（統計GIS）」、どちらも千葉県分）
 *  - 年齢別人口：2020年国勢調査 250m メッシュ（統計表 T001102）。
 *    人口総数・65歳以上・75歳以上を、500m メッシュ（番号の上9桁）ごとに足し合わせる。
 *    「*」は秘匿（隣のマスに合算されている）なので 0 として足す。
 *  - 町丁目の境界：2020年国勢調査 小地域（町丁・字等）の境界。
 *    各マスの中心がどの町丁目に入るかで「検見川町3丁目」のような名前を付ける。
 * 国勢調査は5年に1度なので、毎回は取り直さない（areas.json が無いときだけワークフローが動かす）。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as shapefile from "shapefile";
import { FALLBACK_CENTER, MAX_KM } from "../src/config";
import type { AreaCell, AreaData } from "../src/lib/areas";
import { meshCenter } from "../src/lib/mesh";
import { distanceKm } from "../src/lib/offices";
import { parseCSV } from "../src/lib/opendata";
import { download, expand } from "./net";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "public", "data", "areas.json");

const MESH_URL = "https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001102&code=12&downloadType=2";
const BOUNDARY_URL =
  "https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=12&coordSys=1&format=shape&downloadType=5&datum=2000";

/** 需要を数える範囲（areas.ts の半径）の分だけ、収録範囲より外側まで取っておく */
const KEEP_KM = MAX_KM + 3;

const center = FALLBACK_CENTER;

function num(s: string | undefined): number {
  const v = Number(String(s ?? "").trim());
  return Number.isFinite(v) ? v : 0;
}

async function meshPopulation(): Promise<Map<string, AreaCell>> {
  const files = await expand({ name: "mesh.zip", bytes: await download(MESH_URL) }, /\.txt$/i);
  const text = new TextDecoder("shift_jis").decode(files[0].bytes);
  const cells = new Map<string, AreaCell>();
  let codes: string[] | null = null;
  let col: { pop: number; p65: number; p75: number } | null = null;
  let line = 0;
  parseCSV(text, (r) => {
    line++;
    if (line === 1) {
      codes = r;
      return;
    }
    if (line === 2) {
      const names = r.map((h) => h.normalize("NFKC").replace(/\s+/g, ""));
      const find = (re: RegExp) => names.findIndex((h) => re.test(h));
      col = { pop: find(/^人口\(総数\)$/), p65: find(/^65歳以上人口総数$/), p75: find(/^75歳以上人口総数$/) };
      if (col.pop < 0 || col.p65 < 0 || col.p75 < 0) {
        throw new Error(`人口の列が見つかりません: ${names.slice(0, 40).join(",")}`);
      }
      return;
    }
    if (!codes || !col) return;
    const key = (r[0] ?? "").trim();
    if (!/^\d{9,10}$/.test(key)) return;
    const code = key.slice(0, 9);
    const c = meshCenter(code);
    if (distanceKm(center, c) > KEEP_KM) return;
    const cell = cells.get(code) ?? { c: code, pop: 0, p65: 0, p75: 0 };
    cell.pop += num(r[col.pop]);
    cell.p65 += num(r[col.p65]);
    cell.p75 += num(r[col.p75]);
    cells.set(code, cell);
  });
  return cells;
}

type Ring = [number, number][];
type Town = { name: string; bbox: [number, number, number, number]; polys: Ring[][] };

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inTown(x: number, y: number, t: Town): boolean {
  const [minX, minY, maxX, maxY] = t.bbox;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  return t.polys.some((rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h)));
}

async function towns(): Promise<Town[]> {
  const files = await expand({ name: "boundary.zip", bytes: await download(BOUNDARY_URL) }, /\.(shp|dbf)$/i);
  const shp = files.find((f) => /\.shp$/i.test(f.name));
  const dbf = files.find((f) => /\.dbf$/i.test(f.name));
  if (!shp || !dbf) throw new Error("境界データの中に .shp / .dbf がありません");
  const toAB = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  const source = await shapefile.open(toAB(shp.bytes), toAB(dbf.bytes), { encoding: "shift_jis" });
  const out: Town[] = [];
  const dLat = (KEEP_KM + 1) / 110.57;
  const dLng = (KEEP_KM + 1) / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  for (;;) {
    const r = await source.read();
    if (r.done) break;
    const f = r.value;
    const p = f.properties as Record<string, unknown>;
    if (Number(p.HCODE) !== 8101 || !f.geometry) continue;
    const g = f.geometry as { type: string; coordinates: unknown };
    const polys: Ring[][] =
      g.type === "Polygon" ? [g.coordinates as Ring[]] : g.type === "MultiPolygon" ? (g.coordinates as Ring[][]) : [];
    if (!polys.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const rings of polys)
      for (const [x, y] of rings[0]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    if (maxY < center.lat - dLat || minY > center.lat + dLat || maxX < center.lng - dLng || minX > center.lng + dLng) continue;
    const city = String(p.CITY_NAME ?? "").normalize("NFKC").replace(/^千葉市/, "");
    const name = `${city}${String(p.S_NAME ?? "").normalize("NFKC")}`.trim();
    out.push({ name, bbox: [minX, minY, maxX, maxY], polys });
  }
  return out;
}

async function main() {
  const cells = await meshPopulation();
  console.log(`人口のマス: ${cells.size}（500m 四方、自社から ${KEEP_KM}km 以内）`);
  let named = 0;
  try {
    const list = await towns();
    console.log(`町丁目: ${list.length}`);
    for (const cell of cells.values()) {
      const c = meshCenter(cell.c);
      const t = list.find((town) => inTown(c.lng, c.lat, town));
      if (t) {
        cell.n = t.name;
        named++;
      }
    }
  } catch (e) {
    console.warn(`町丁目の境界を読めませんでした（町名なしで続けます）: ${String(e)}`);
  }
  const list = [...cells.values()].filter((c) => c.pop > 0).sort((a, b) => a.c.localeCompare(b.c));
  const total = list.reduce((s, c) => s + c.pop, 0);
  const t75 = list.reduce((s, c) => s + c.p75, 0);
  console.log(`areas.json: ${list.length} マス（町名あり ${named}）、人口 ${total}、75歳以上 ${t75}`);
  const data: AreaData = {
    generatedAt: new Date().toISOString(),
    source: "総務省統計局「令和2年国勢調査」250mメッシュ（500m四方に集計）・小地域境界（e-Stat）",
    cells: list,
  };
  await mkdir(join(ROOT, "public", "data"), { recursive: true });
  await writeFile(OUT, JSON.stringify(data) + "\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
