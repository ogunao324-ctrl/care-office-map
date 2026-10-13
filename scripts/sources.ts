/**
 * 公表ページの HTML から、ダウンロードするファイルの URL を拾う（通信はしない）
 *
 * - 厚労省：https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html
 *   「110_訪問介護［15.4MB］」のようなリンクが、新しい時点から順に並んでいる。
 *   いちばん上に出てくるものが最新。直前の見出し（「2026年６月末時点」）を時点として拾う。
 * - WAM NET：https://www.wam.go.jp/content/wamnet/pcpub/top/sfkopendata/
 *   表のマスに「居宅介護」などのサービス名とダウンロードの画像リンクが入っている。
 *   ページの作りが変わって拾えないときは、GitHub Actions の手動実行で URL を直接渡せる。
 */

export const MHLW_PAGE = "https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html";
export const WAM_PAGE = "https://www.wam.go.jp/content/wamnet/pcpub/top/sfkopendata/";

/** 厚労省から取るサービス（リンクの文字の先頭の番号）。110 訪問介護・130 訪問看護・430 居宅介護支援 */
export const MHLW_TARGETS = ["110", "130", "430"] as const;

/** WAM NET から取るサービス（表のマスの文字と完全一致で探す） */
export const WAM_TARGETS = ["居宅介護", "重度訪問介護", "同行援護", "行動援護", "計画相談支援", "障害児相談支援"] as const;

export type FoundLink = { label: string; url: string; asOf?: string };

function stripTags(html: string, withAlt = true): string {
  return html
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, withAlt ? " $1 " : " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function squash(s: string): string {
  return s.normalize("NFKC").replace(/\s/g, "");
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href.replace(/&amp;/g, "&"), base).toString();
  } catch {
    return href;
  }
}

/** 厚労省のページから、番号ごとの最新ファイルを拾う */
export function findMhlwLinks(html: string, base = MHLW_PAGE): FoundLink[] {
  const out: FoundLink[] = [];
  const headings: { at: number; text: string }[] = [];
  for (const m of html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi)) {
    headings.push({ at: m.index ?? 0, text: stripTags(m[1]) });
  }
  for (const code of MHLW_TARGETS) {
    for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = squash(stripTags(m[2]));
      if (!text.startsWith(`${code}_`)) continue;
      if (!/\.(csv|zip)(\?|$)/i.test(m[1])) continue;
      const at = m.index ?? 0;
      const heading = headings.filter((h) => h.at < at).pop();
      out.push({ label: text.replace(/[［\[].*$/, ""), url: absolute(m[1], base), asOf: heading?.text });
      break;
    }
  }
  return out;
}

/** WAM NET のページから、サービス名のマスにあるファイルを拾う */
export function findWamLinks(html: string, base = WAM_PAGE): FoundLink[] {
  const out: FoundLink[] = [];
  const cells = [...html.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
  for (const target of WAM_TARGETS) {
    let url: string | null = null;
    for (const cell of cells) {
      // 画像の alt（「ダウンロード」など）や「（CSV 1.2MB）」のような添え書きは外して比べる
      const label = squash(stripTags(cell, false)).replace(/[（(［\[].*$/, "");
      if (label !== squash(target)) continue;
      const href = /href="([^"]+\.(?:csv|zip)(?:\?[^"]*)?)"/i.exec(cell);
      if (href) {
        url = absolute(href[1], base);
        break;
      }
    }
    // 表になっていない作りのときの予備：リンクの文字や画像の alt にサービス名がある
    if (!url) {
      for (const m of html.matchAll(/<a\b[^>]*href="([^"]+\.(?:csv|zip)(?:\?[^"]*)?)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        if (squash(stripTags(m[2])) === squash(target)) {
          url = absolute(m[1], base);
          break;
        }
      }
    }
    if (url) out.push({ label: target, url, asOf: wamAsOf(url) });
  }
  return out;
}

/** ページ内の csv / zip のリンクを全部（拾えなかったときの手がかり用） */
export function listDataLinks(html: string, base: string): string[] {
  return [...html.matchAll(/href="([^"]+\.(?:csv|zip)(?:\?[^"]*)?)"/gi)].map((m) => absolute(m[1], base));
}

/** 「2026年６月末時点」「2025年9月末」→ "2026-06"。読めなければ null */
export function ymFromText(text: string): string | null {
  const m = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(text.normalize("NFKC"));
  return m ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
}

export type HistoryLink = { code: string; url: string; ym: string };

/**
 * 厚労省のページから、過去の時点も含めた全部のファイルを拾う（履歴用）。
 * ファイル名は時点によってバラバラ（jigyosho_110.csv / 001528432.csv / …zip）なので、
 * リンクの文字「110_訪問介護」と、直前の見出し「2026年６月末時点」で決める。
 */
export function findAllMhlwLinks(html: string, codes: readonly string[], base = MHLW_PAGE): HistoryLink[] {
  const out: HistoryLink[] = [];
  const tokens = [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>|<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  let ym: string | null = null;
  for (const t of tokens) {
    if (t[1] != null) {
      const y = ymFromText(stripTags(t[1]));
      if (y && /時点/.test(stripTags(t[1]))) ym = y;
      continue;
    }
    const href = t[2];
    const text = squash(stripTags(t[3] ?? ""));
    if (!ym || !/\.(csv|zip)(\?|$)/i.test(href)) continue;
    const code = codes.find((c) => text.startsWith(`${c}_`));
    if (!code) continue;
    if (out.some((o) => o.ym === ym && o.code === code)) continue;
    out.push({ code, url: absolute(href, base), ym });
  }
  return out;
}

/** WAM NET のページから、過去の時点も含めた全部のファイルを拾う（sfkopendata_202603_11.zip の 202603 と 11） */
export function findAllWamLinks(html: string, codes: readonly string[], base = WAM_PAGE): HistoryLink[] {
  const out: HistoryLink[] = [];
  for (const m of html.matchAll(/href="([^"]*sfkopendata_(\d{4})(\d{2})_(\d{2})\.zip)"/gi)) {
    const [, href, y, mo, code] = m;
    if (!codes.includes(code)) continue;
    const ym = `${y}-${mo}`;
    if (out.some((o) => o.ym === ym && o.code === code)) continue;
    out.push({ code, url: absolute(href, base), ym });
  }
  return out;
}

/** WAM NET のファイルの URL から時点を読む（最新の取り込みで「2026年3月末時点」と出すため） */
export function wamAsOf(url: string): string | undefined {
  const m = /sfkopendata_(\d{4})(\d{2})_\d{2}\.zip/.exec(url);
  return m ? `${m[1]}年${Number(m[2])}月末時点` : undefined;
}
