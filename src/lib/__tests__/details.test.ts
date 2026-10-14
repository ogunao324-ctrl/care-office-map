/**
 * 介護サービス情報公表システムの「事業所の詳細」ページの読み取りのテスト
 * 見本（fixtures/kihon-*.html）は実際のページから表の部分だけを残して縮めたもの
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cleanKasan, isStale, kasanShares, metricOf, parseKihon, tokuteiOf } from "../details";

const page = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

test("訪問介護：職員・提供時間・利用者（前年同月）・加算", () => {
  const d = parseKihon(page("kihon-110.html"), "110");
  assert.ok(d);
  assert.equal(d.asOf, "2025-12-09");
  assert.equal(d.start, "2004-04-01");
  assert.deepEqual(d.staff, { full: 11, head: 35, fte: 16.5 });
  assert.equal(d.sub?.head, 6);
  assert.equal(d.hoursPer, 98.8);
  // 採用・退職は［常勤・うちサービス提供責任者・非常勤］の常勤＋非常勤
  assert.equal(d.hired, 2);
  assert.equal(d.left, 3);
  assert.equal(d.veteran, 0.686);
  assert.equal(d.body, 1105);
  assert.equal(d.life, 526);
  assert.equal(d.users, 151);
  assert.equal(d.usersPrev, 147);
  assert.ok(d.kasanListed);
  assert.deepEqual(d.kasan, ["特定事業所加算（Ⅱ）", "緊急時訪問介護加算", "生活機能向上連携加算（Ⅱ）", "介護職員等処遇改善加算（Ⅰ）"]);
  assert.deepEqual(tokuteiOf(d), ["Ⅱ"]);
  assert.equal(metricOf(d, "hours"), 1631);
  assert.equal(metricOf(d, "growth"), 4);
});

test("訪問看護：看護職の合計・医療保険も含めた利用者・医療処置", () => {
  const d = parseKihon(page("kihon-130.html"), "130");
  assert.ok(d);
  assert.equal(d.asOf, "2025-09-15");
  assert.deepEqual(d.staff, { head: 9, full: 3, fte: 6.43 });
  assert.equal(d.sub?.head, 0);
  assert.equal(d.hoursPer, 120);
  assert.equal(d.users, 0);
  assert.equal(d.usersAll, 15);
  assert.equal(metricOf(d, "users"), 15);
  assert.deepEqual(d.kasan, []);
  assert.ok(d.kasanListed);
  assert.deepEqual(d.feats, ["定期巡回・随時対応型訪問介護看護事業所との連携"]);
  assert.ok(d.treat.includes("麻薬を用いた疼痛管理"));
  assert.ok(!d.treat.includes("人工呼吸療法（レスピレーター、ベンチレーター）"));
});

test("居宅介護支援：ケアマネ数・1人当たりの利用者数・加算", () => {
  const d = parseKihon(page("kihon-430.html"), "430");
  assert.ok(d);
  assert.equal(d.start, "2024-04-01");
  assert.equal(d.staff?.head, 1);
  assert.equal(d.sub?.head, 1);
  assert.equal(d.perCm, 44);
  assert.equal(d.users, 41);
  assert.equal(d.usersPrev, 26);
  assert.ok(d.kasan.includes("通院時情報連携加算"));
  assert.ok(!d.kasan.some((k) => k.startsWith("特定事業所加算")));
});

test("古い様式のページ（2012〜2013年の記入）も読め、古いと判定される", () => {
  const h = parseKihon(page("kihon-110-old.html"), "110");
  assert.ok(h);
  assert.equal(h.asOf, "2012-11-15");
  assert.equal(h.staff?.head, 19);
  // 要介護（23人）と要支援（4人）の表を足す
  assert.equal(h.users, 27);
  assert.equal(h.usersPrev, 24);
  assert.deepEqual(h.feats, ["通院等乗降介助"]);
  assert.equal(isStale(h, new Date("2026-10-14")), true);
  const c = parseKihon(page("kihon-430-old.html"), "430");
  assert.equal(c?.users, 24);
  assert.equal(c?.staff?.fte, 11.9);
  const n = parseKihon(page("kihon-110.html"), "110");
  assert.ok(n && !isStale(n, new Date("2026-10-14")));
});

test("見つからない事業所のページは null", () => {
  assert.equal(parseKihon(page("kihon-error.html"), "110"), null);
});

test("加算の名前を短くする・取っている割合", () => {
  assert.equal(cleanKasan("特定事業所加算(Ⅰ)　※体制要件、人材要件及び重度対応要件に適合"), "特定事業所加算（Ⅰ）");
  assert.equal(cleanKasan("ターミナルケア加算（予防を除く）"), "ターミナルケア加算");
  assert.equal(cleanKasan("看護体制強化加算（Ⅰ）（予防を除く）"), "看護体制強化加算（Ⅰ）");
  const base = { kasanListed: true, feats: [], treat: [] };
  const shares = kasanShares([
    { ...base, kasan: ["A加算", "B加算"] },
    { ...base, kasan: ["A加算"] },
    { ...base, kasan: [], kasanListed: false },
  ]);
  assert.deepEqual(shares, [
    { name: "A加算", count: 2, of: 2 },
    { name: "B加算", count: 1, of: 2 },
  ]);
});

test("営業の道順：近い順につなぎ、Googleマップの道順の URL を作る", async () => {
  const { orderStops, routeUrl } = await import("../route");
  const home = { lat: 35.65, lng: 140.05 };
  const far = { lat: 35.65, lng: 140.1, id: "far" };
  const near = { lat: 35.65, lng: 140.06, id: "near" };
  const mid = { lat: 35.65, lng: 140.08, id: "mid" };
  assert.deepEqual(orderStops(home, [far, near, mid]).map((s) => s.id), ["near", "mid", "far"]);
  const back = new URL(routeUrl(home, [near, mid], true));
  assert.equal(back.searchParams.get("destination"), "35.65,140.05");
  assert.equal(back.searchParams.get("waypoints"), "35.65,140.06|35.65,140.08");
  const oneWay = new URL(routeUrl(home, [near, mid], false));
  assert.equal(oneWay.searchParams.get("destination"), "35.65,140.08");
  assert.equal(oneWay.searchParams.get("waypoints"), "35.65,140.06");
  assert.equal(routeUrl(home, [], true), "");
});
