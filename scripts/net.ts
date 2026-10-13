/**
 * データ取得スクリプトで共通に使う、ダウンロードと ZIP の展開
 */

import { basename } from "node:path";
import JSZip from "jszip";
import { decodeText } from "../src/lib/opendata";

const UA = "Mozilla/5.0 (care-office-map data updater)";

export async function download(url: string): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw new Error(`${url} を取得できませんでした: ${String(lastErr)}`);
}

export async function fetchText(url: string): Promise<string> {
  return decodeText(await download(url));
}

export type Input = { name: string; bytes: Uint8Array; url?: string; asOf?: string };

export function isZip(b: Uint8Array): boolean {
  return b[0] === 0x50 && b[1] === 0x4b;
}

/** ZIP なら中のファイル（pattern に合うもの）を全部取り出す。ZIP でなければそのまま */
export async function expand(input: Input, pattern = /\.csv$/i): Promise<Input[]> {
  if (!isZip(input.bytes)) return [input];
  const zip = await JSZip.loadAsync(input.bytes);
  const out: Input[] = [];
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (f.dir || !pattern.test(name)) continue;
    out.push({ name: basename(name), bytes: await f.async("uint8array"), url: input.url, asOf: input.asOf });
  }
  if (!out.length) throw new Error(`${input.name}: ZIP の中に目的のファイルがありません`);
  return out;
}
