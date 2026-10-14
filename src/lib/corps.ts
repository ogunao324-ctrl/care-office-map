/**
 * 法人ごとの勢力図
 *
 * 事業所を法人ごとにまとめ、範囲内に何か所持っているか・どのサービスを組み合わせているかを数える。
 * まとめる鍵は法人番号（13桁）。無い事業所は法人名（表記ゆれを寄せたもの）で代わりにまとめる。
 * 法人名も無い事業所は「法人名なし」として、ランキングには入れず件数だけ数える。
 */

import { CATEGORY_ORDER, type CategoryId, type Office } from "./offices";
import { searchKey } from "./search-text";

export type CorpType = "company" | "welfare" | "medical" | "npo" | "assoc" | "coop" | "gov" | "other";

export const CORP_TYPE_LABEL: Record<CorpType, string> = {
  company: "株式会社など（営利法人）",
  welfare: "社会福祉法人",
  medical: "医療法人",
  npo: "NPO法人",
  assoc: "一般社団・財団法人",
  coop: "生協・協同組合",
  gov: "市町村など",
  other: "その他",
};

export const CORP_TYPE_ORDER: CorpType[] = ["company", "welfare", "medical", "npo", "assoc", "coop", "gov", "other"];

/** 法人名から法人の種類を決める（「医療法人社団」「社会福祉法人」など、名前に必ず入る言葉で見る） */
export function corpTypeOf(name: string | undefined): CorpType {
  const s = String(name ?? "").normalize("NFKC");
  if (/社会福祉法人|社会福祉事業団/.test(s)) return "welfare";
  if (/医療法人|医療生活協同組合|医療生協/.test(s)) return "medical";
  if (/特定非営利活動法人|NPO法人|^NPO/.test(s)) return "npo";
  if (/(一般|公益)(社団|財団)法人/.test(s)) return "assoc";
  if (/協同組合|生協/.test(s)) return "coop";
  if (/株式会社|有限会社|合同会社|合資会社|合名会社|\((株|有|同)\)|㈱|㈲/.test(s)) return "company";
  if (/^(千葉県|.{1,6}(市|町|村))$|広域連合|一部事務組合/.test(s)) return "gov";
  return "other";
}

/** 表示用の法人名：全角英数を半角に、「株式会社　ニチイ学館」のような種別のあとの空白を詰める */
export function prettyCorpName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/(株式会社|有限会社|合同会社|社会福祉法人|医療法人社団|医療法人財団|医療法人|特定非営利活動法人|一般社団法人|一般財団法人|公益社団法人|公益財団法人) /g, "$1")
    .replace(/ (株式会社|有限会社|合同会社)$/g, "$1")
    .trim();
}

/** 法人名の表記ゆれ（全角・空白・(株)など）を寄せた比較用の文字列 */
export function corpNameKey(name: string): string {
  return searchKey(
    name
      .normalize("NFKC")
      .replace(/\(株\)|㈱/g, "株式会社")
      .replace(/\(有\)|㈲/g, "有限会社"),
  ).replace(/[\s・]/g, "");
}

export function corpKeyOf(o: Pick<Office, "corp" | "corpNo">): string | null {
  if (o.corpNo) return `no:${o.corpNo}`;
  if (o.corp && o.corp.trim()) return `name:${corpNameKey(o.corp)}`;
  return null;
}

type WithDistance = Office & { distance: number | null };

export type CorpSummary = {
  key: string;
  name: string;
  type: CorpType;
  /** 範囲内で、選んだ種類のサービスをしている事業所 */
  offices: WithDistance[];
  /** 収録範囲（10km）全体の、この法人の事業所（種類を問わない） */
  all: WithDistance[];
  /** 範囲内の事業所の、種類ごとの数（1つの事業所が複数の種類に数えられることがある） */
  byCat: Record<CategoryId, number>;
  /** 介護（居宅・訪問介護・訪問看護）と障害（訪問系・相談支援）の両方をしているか */
  both: boolean;
  nearest: number | null;
};

export type CorpLandscape = {
  corps: CorpSummary[];
  /** 範囲内・選んだ種類の事業所の数（法人名の無いものも含む） */
  totalOffices: number;
  /** 法人名の無い事業所の数 */
  noCorp: number;
  /** 上位5法人の事業所が全体に占める割合（0〜1） */
  top5Share: number;
  /** 範囲内に1か所だけの法人の数 */
  singles: number;
  byType: { type: CorpType; corps: number; offices: number }[];
};

const KAIGO = new Set<CategoryId>(["cm", "hh", "vn"]);
const SHOGAI = new Set<CategoryId>(["dv", "cs"]);

export function corpLandscape(
  offices: WithDistance[],
  opts: { radiusKm: number; cats: Record<CategoryId, boolean>; bothOnly?: boolean },
): CorpLandscape {
  const groups = new Map<string, WithDistance[]>();
  for (const o of offices) {
    const k = corpKeyOf(o);
    if (!k) continue;
    const g = groups.get(k) ?? [];
    g.push(o);
    groups.set(k, g);
  }

  const active = (o: WithDistance) => o.categories.some((c) => opts.cats[c]);
  const inRange = (o: WithDistance) => o.distance != null && o.distance <= opts.radiusKm + 1e-9;

  let noCorp = 0;
  let totalOffices = 0;
  for (const o of offices) {
    if (!inRange(o) || !active(o)) continue;
    totalOffices++;
    if (!corpKeyOf(o)) noCorp++;
  }

  const corps: CorpSummary[] = [];
  for (const [key, all] of groups) {
    const allCats = new Set(all.flatMap((o) => o.categories));
    const both = [...allCats].some((c) => KAIGO.has(c)) && [...allCats].some((c) => SHOGAI.has(c));
    if (opts.bothOnly && !both) continue;
    const list = all.filter((o) => inRange(o) && active(o)).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    if (!list.length) continue;
    // 表示名は一番多い書き方。同じ数なら（株）などの略さない長い方
    const names = new Map<string, number>();
    for (const o of all) if (o.corp) names.set(prettyCorpName(o.corp), (names.get(prettyCorpName(o.corp)) ?? 0) + 1);
    const name = [...names].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? "（法人名なし）";
    const byCat = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<CategoryId, number>;
    for (const o of list) for (const c of o.categories) if (opts.cats[c]) byCat[c]++;
    corps.push({
      key,
      name,
      type: corpTypeOf(name),
      offices: list,
      all: [...all].sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99)),
      byCat,
      both,
      nearest: list[0]?.distance ?? null,
    });
  }
  corps.sort((a, b) => b.offices.length - a.offices.length || b.all.length - a.all.length || (a.nearest ?? 99) - (b.nearest ?? 99));

  const counted = corps.reduce((s, c) => s + c.offices.length, 0);
  const top5 = corps.slice(0, 5).reduce((s, c) => s + c.offices.length, 0);
  const byType = CORP_TYPE_ORDER.map((type) => {
    const list = corps.filter((c) => c.type === type);
    return { type, corps: list.length, offices: list.reduce((s, c) => s + c.offices.length, 0) };
  }).filter((t) => t.corps > 0);

  return {
    corps,
    totalOffices: opts.bothOnly ? counted : totalOffices,
    noCorp: opts.bothOnly ? 0 : noCorp,
    top5Share: counted ? top5 / counted : 0,
    singles: corps.filter((c) => c.offices.length === 1).length,
    byType,
  };
}
