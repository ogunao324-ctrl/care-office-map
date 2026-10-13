/**
 * 公表データの読み取り・まとめ・リンク拾いのテスト
 *
 * fixtures/ の CSV と HTML は、本物の列名・ページの作りに似せて手で作った見本。
 * 中の事業所・URL は架空のもの。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { findMhlwLinks, findWamLinks } from "../../../scripts/sources";
import { FALLBACK_CENTER, HOME_WARD, SELF_ADDRESS_KEY } from "../../config";
import { categoryOf, normAddr, normalizeUrl } from "../offices";
import { decodeText, findSelf, mergeOffices, parseCSV, parseOpenData } from "../opendata";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name));
const opt = { center: FALLBACK_CENTER, maxKm: 10, homeWard: HOME_WARD };

test("CSV: 引用符・二重引用符・CRLF を読める", () => {
  const rows: string[][] = [];
  parseCSV('a,"b,""c""",d\r\n1,2,3\r\n', (r) => rows.push(r));
  assert.deepEqual(rows, [
    ["a", 'b,"c"', "d"],
    ["1", "2", "3"],
  ]);
});

test("厚労省の表: 10km 外を落とし、サービス名はファイル名からも決まる", () => {
  const res = parseOpenData(decodeText(fx("jigyosho_110_sample.csv")), "jigyosho_110_sample.csv", opt);
  assert.equal(res.total, 3);
  assert.equal(res.rows.length, 2);
  assert.ok(res.rows.every((r) => r.service === "訪問介護"));
  assert.equal(res.rows[1].name, 'さつきケア "検見川"');
  assert.match(res.rows[0].address, /メゾンセレーザ/);
  assert.equal(res.rows[0].days, "利用可能：月,火,水,木,金");
});

test("WAM NET の表: 住所を2列から作り、位置のない行は区の住所なら残す", () => {
  const res = parseOpenData(decodeText(fx("wam_sample.csv")), "wam_sample.csv", opt);
  assert.deepEqual([...new Set(res.rows.map((r) => r.service))], ["居宅介護", "重度訪問介護", "計画相談支援"]);
  assert.equal(res.noLocation, 1);
  const noLoc = res.rows.find((r) => r.lat == null);
  assert.equal(noLoc?.address, "千葉県千葉市花見川区幕張町5-1");
  assert.equal(res.rows.find((r) => r.service === "計画相談支援")?.days, "定休日：土日祝");
});

test("同じ事業所の介護と障害の指定を1件にまとめ、自社を見つける", () => {
  const a = parseOpenData(decodeText(fx("jigyosho_110_sample.csv")), "jigyosho_110_sample.csv", opt).rows;
  const b = parseOpenData(decodeText(fx("wam_sample.csv")), "wam_sample.csv", opt).rows;
  const offices = mergeOffices([...a, ...b], SELF_ADDRESS_KEY);
  const self = offices.find((o) => o.self);
  assert.ok(self);
  assert.deepEqual(self.services, ["訪問介護", "居宅介護", "重度訪問介護"]);
  assert.deepEqual(self.categories, ["hh", "dv"]);
  assert.deepEqual(self.numbers, ["1270000001", "1210200001"]);
  assert.equal(offices.length, 4);
  assert.equal(findSelf([...a, ...b], SELF_ADDRESS_KEY)?.name, "ヘルパーステーションなみはな");
});

test("住所の表記ゆれ（全角・番地・号）を寄せる", () => {
  assert.equal(normAddr("浪花町９８－４４　メゾン"), "浪花町98-44メゾン");
  assert.equal(normAddr("浪花町98番44号"), "浪花町98-44");
  assert.equal(normAddr("浪花町98番地の44"), "浪花町98-44");
});

test("厚労省のページ: いちばん新しい時点のリンクと時点を拾う", () => {
  const links = findMhlwLinks(fx("mhlw_page.html").toString("utf8"));
  assert.deepEqual(
    links.map((l) => [l.label, l.url, l.asOf]),
    [
      ["110_訪問介護", "https://www.mhlw.go.jp/content/12300000/jigyosho_110_all_20260709180319.csv", "2026年６月末時点"],
      ["130_訪問看護", "https://www.mhlw.go.jp/content/12300000/jigyosho_130_all_20260709180342.csv", "2026年６月末時点"],
      ["430_居宅介護支援", "https://www.mhlw.go.jp/content/12300000/jigyosho_430_all_20260709180740.csv", "2026年６月末時点"],
    ],
  );
});

test("WAM NET のページ: サービス名のマス・画像の alt からリンクを拾う", () => {
  const links = findWamLinks(fx("wam_page.html").toString("utf8"));
  assert.deepEqual(
    links.map((l) => l.label),
    ["居宅介護", "重度訪問介護", "同行援護", "計画相談支援", "障害児相談支援"],
  );
  assert.ok(links.every((l) => l.url.startsWith("https://www.wam.go.jp/content/files/")));
});

test("サービス名の分類（似た名前を取り違えない）", () => {
  assert.equal(categoryOf("訪問看護"), "vn");
  assert.equal(categoryOf("訪問介護"), "hh");
  assert.equal(categoryOf("定期巡回・随時対応型訪問介護看護"), "hh");
  assert.equal(categoryOf("居宅介護支援"), "cm");
  assert.equal(categoryOf("居宅介護"), "dv");
  assert.equal(categoryOf("重度訪問介護"), "dv");
  assert.equal(categoryOf("障害児相談支援"), "cs");
});

test("住所の列に建物名が入っていれば、方書を二重に付けない", () => {
  const csv = [
    "事業所名,住所,方書（ビル名等）,緯度,経度",
    "A,千葉県千葉市花見川区浪花町908-44メゾンセレーザ202,メゾンセレーザ２０２,35.6573,140.0661",
    "B,千葉県千葉市花見川区浪花町958-1,コーポ1F,35.6580,140.0670",
  ].join("\n");
  const rows = parseOpenData(csv, "jigyosho_130_x.csv", opt).rows;
  assert.equal(rows[0].address, "千葉県千葉市花見川区浪花町908-44メゾンセレーザ202");
  assert.equal(rows[1].address, "千葉県千葉市花見川区浪花町958-1 コーポ1F");
  assert.equal(rows[0].service, "訪問看護");
  assert.equal(findSelf(rows, "メゾンセレーザ")?.name, "A");
});

test("ホームページの URL を直す（崩れた書き方・メールアドレス）", () => {
  const cases: [string, string | null][] = [
    ["https://example.jp/", "https://example.jp/"],
    ["https:www.example.org", "https://www.example.org/"],
    ["https:/www.example.co.jp", "https://www.example.co.jp/"],
    ["http:/www.example.co.jp", "http://www.example.co.jp/"],
    ["https//www-example.co.jp", "https://www-example.co.jp/"],
    ["htpps://www.example.com", "https://www.example.com/"],
    ["ｈｔｔｐ://www.example.com", "http://www.example.com/"],
    ["https：//www.example.co/", "https://www.example.co/"],
    ["URL：http://www.mcp‐net.jp/", "http://www.mcp-net.jp/"],
    [":https://example.com/", "https://example.com/"],
    ["http://www．example．jp", "http://www.example.jp/"],
    ["www.example.jp/", "http://www.example.jp/"],
    ["example.com", "http://example.com/"],
    ["ttp-care.jp", "http://ttp-care.jp/"],
    ["info@example.com", null],
    ["", null],
    ["なし", null],
    ["-", null],
  ];
  for (const [raw, want] of cases) assert.equal(normalizeUrl(raw), want, raw);
});
