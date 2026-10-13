/**
 * 需要と競合（メッシュ・充足度）と、競合の動き（履歴）のテスト
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { findAllMhlwLinks, findAllWamLinks, wamAsOf, ymFromText } from "../../../scripts/sources";
import { computeGap, shortageRanking, type AreaCell } from "../areas";
import { countSeries, periodChanges, type HistoryData } from "../history";
import { meshBounds, meshCenter, meshCodeAt } from "../mesh";

test("メッシュ番号 → 緯度経度（1km・500m・250m）", () => {
  const b = meshBounds("53403546");
  assert.ok(Math.abs(b.south - 35.616667) < 1e-5 && Math.abs(b.west - 140.7) < 1e-9);
  assert.ok(Math.abs(b.north - b.south - 30 / 3600) < 1e-12);
  const half = meshBounds("534035464");
  assert.ok(Math.abs(half.south - (b.south + 15 / 3600)) < 1e-12 && Math.abs(half.west - (b.west + 22.5 / 3600)) < 1e-12);
  const quarter = meshBounds("5340354641");
  assert.equal(quarter.south, half.south);
  assert.equal(quarter.west, half.west);
  assert.ok(Math.abs(quarter.east - quarter.west - 11.25 / 3600) < 1e-12);
});

test("時点の文字の読み取り", () => {
  assert.equal(ymFromText("2026年６月末時点"), "2026-06");
  assert.equal(ymFromText("2025年12月末時点"), "2025-12");
  assert.equal(ymFromText("公表データ"), null);
  assert.equal(wamAsOf("https://www.wam.go.jp/content/files/pcpub/top/sfkopendata/202603/sfkopendata_202603_11.zip"), "2026年3月末時点");
});

test("過去分のリンク：見出しの時点とリンクの文字でサービスを決める", () => {
  const html = `
    <h3>2026年６月末時点</h3><a href="/c/jigyosho_110_all_1.csv">110_訪問介護［15MB］</a><a href="/c/jigyosho_120_all.csv">120_訪問入浴介護</a>
    <h3>2025年６月末時点</h3><a href="/c/001528432.csv">110_訪問介護［15.3MB］</a><a href="/c/001528496.csv">430_居宅介護支援</a>
    <h3>2020年12月末時点</h3><a href="/c/2020.12jigyosho_110_all_2.zip">110_訪問介護</a>`;
  assert.deepEqual(
    findAllMhlwLinks(html, ["110", "430"]).map((l) => [l.ym, l.code, l.url.split("/").pop()]),
    [
      ["2026-06", "110", "jigyosho_110_all_1.csv"],
      ["2025-06", "110", "001528432.csv"],
      ["2025-06", "430", "001528496.csv"],
      ["2020-12", "110", "2020.12jigyosho_110_all_2.zip"],
    ],
  );
  const wam = `<a href="/content/files/pcpub/top/sfkopendata/202603/sfkopendata_202603_11.zip">x</a>
    <a href="/content/files/pcpub/top/sfkopendata/202603/sfkopendata_202603_21.zip">x</a>
    <a href="/content/files/pcpub/top/sfkopendata/202111/sfkopendata_202111_52.zip">x</a>`;
  assert.deepEqual(
    findAllWamLinks(wam, ["11", "52"]).map((l) => [l.ym, l.code]),
    [
      ["2026-03", "11"],
      ["2021-11", "52"],
    ],
  );
});

const center = { lat: 35.65, lng: 140.05 };

test("充足度：事業所が少ないマスほど平均に対して低く出る", () => {
  // 東西に並んだ 1km メッシュ相当の5マス（中心の間隔 約1.1km）。人口は同じ、事業所は西に偏る
  const codes = ["53403100", "53403101", "53403102", "53403103", "53403104"];
  const cells: AreaCell[] = codes.map((c) => ({ c, n: `町${c.slice(-1)}`, pop: 5000, p65: 1500, p75: 800 }));
  const west = meshCenter(codes[0]);
  const offices = [0, 1, 2].map(() => ({ lat: west.lat, lng: west.lng, categories: ["hh" as const] }));
  const { cells: gap, average } = computeGap(cells, offices, { center: meshCenter(codes[2]), category: "hh", base: "p75", radiusKm: 1.5, maxKm: 10 });
  const byName = Object.fromEntries(gap.map((g) => [g.n, g]));
  // 全体：事業所3か所 ÷ 75歳以上 4,000人 → 1,000人あたり 0.75
  assert.equal(average, 0.75);
  assert.equal(byName["町0"].supply, 3);
  assert.equal(byName["町4"].supply, 0);
  assert.ok((byName["町4"].index ?? 1) < (byName["町0"].index ?? 0));
  const rank = shortageRanking(gap, "p75");
  assert.equal(rank[0].supply, 0);
  assert.ok(!rank.some((g) => g.n === "町0"));
});

const hist: HistoryData = {
  generatedAt: "",
  snapshots: { kaigo: ["2025-06", "2025-12", "2026-06"], shogai: ["2025-09", "2026-03"] },
  offices: [
    // ずっとある
    { src: "kaigo", s: "訪問介護", no: "1", n: "A", a: "", la: 35.65, lo: 140.05, p: "111" },
    // 2026-06 に新規
    { src: "kaigo", s: "訪問介護", no: "2", n: "B", a: "", la: 35.651, lo: 140.05, p: "001" },
    // 2025-12 でなくなった
    { src: "kaigo", s: "訪問介護", no: "3", n: "C", a: "", la: 35.652, lo: 140.05, p: "100" },
    // 既存の事業所（番号1）が訪問看護を始めた
    { src: "kaigo", s: "訪問看護", no: "1", n: "A", a: "", la: 35.65, lo: 140.05, p: "001" },
    // 遠い（範囲外）
    { src: "kaigo", s: "訪問介護", no: "9", n: "Z", a: "", la: 36.5, lo: 140.05, p: "001" },
    // 障害：重度訪問介護を終えた（居宅介護は続けている）
    { src: "shogai", s: "居宅介護", no: "5", n: "D", a: "", la: 35.65, lo: 140.051, p: "11" },
    { src: "shogai", s: "重度訪問介護", no: "5", n: "D", a: "", la: 35.65, lo: 140.051, p: "10" },
  ],
};

test("履歴：範囲内の事業所数の推移", () => {
  assert.deepEqual(
    countSeries(hist, center, 3, "hh").map((p) => p.count),
    [2, 1, 2],
  );
  assert.deepEqual(
    countSeries(hist, center, 3, "dv").map((p) => p.count),
    [1, 1],
  );
});

test("履歴：期間内の新規・サービス追加・なくなった・サービス終了", () => {
  const half = periodChanges(hist, center, 3, 6);
  const kinds = half.map((c) => `${c.src}:${c.no}:${c.kind}:${c.services.join("/")}`).sort();
  assert.deepEqual(kinds, ["kaigo:1:added:訪問看護", "kaigo:2:open:訪問介護", "shogai:5:dropped:重度訪問介護"]);
  const year = periodChanges(hist, center, 3, 12);
  assert.ok(year.some((c) => c.no === "3" && c.kind === "closed"));
  assert.equal(year.find((c) => c.no === "3")?.from, "2025-06");
});

test("緯度経度 → 500m メッシュ番号（中心から戻すと同じ番号）", () => {
  for (const code of ["533935464", "534035461", "534035462", "534035463", "534035464", "533946171"]) {
    const c = meshCenter(code);
    assert.equal(meshCodeAt(c.lat, c.lng), code);
  }
  // 自社のあたり
  assert.equal(meshCodeAt(35.657369, 140.066266).slice(0, 4), "5340");
});
