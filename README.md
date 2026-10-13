# 花見川 事業所マップ

自社（千葉市花見川区浪花町）の周辺にある事業所を、地図と「自社から近い順」の一覧で探すアプリ。

- 対象：居宅介護支援・訪問介護・訪問看護（介護保険）、居宅介護・重度訪問介護・同行援護・行動援護・計画相談支援・障害児相談支援（障害福祉）
- 自社から 10km 以内を収録。画面では 1 / 2 / 3 / 5 / 10km で切り替え
- 名前・法人名・住所・電話番号で検索（ひらがな・カタカナ・半角カナを区別しない。つむぐと同じ寄せ方）
- 詳細から Googleマップ・自社からの道順・電話・ホームページ・公表ページ（従業者の数・決算書類）へ
- 地図はつむぐと同じ見た目：既定は文字の無い白地図（Esri）に駅・区の名前を控えめに重ねたもの。国土地理院の淡色地図にも切り替え可

## 構成

| 場所 | 中身 |
| --- | --- |
| `src/components/OfficeMapApp.tsx` | 画面全体（検索・絞り込み・一覧・詳細） |
| `src/components/OfficeMap.tsx` | 地図（Leaflet） |
| `src/config.ts` | 自社の住所・予備の中心座標・収録範囲 |
| `src/lib/opendata.ts` | 公表データ（CSV）の読み取りと、事業所ごとのまとめ |
| `scripts/update-data.ts` | 公表データを取得して `public/data/offices.json` を作る |
| `scripts/sources.ts` | 公表ページからダウンロード先の URL を拾う |
| `data/rows/` | サービスごとの取得結果（介護と障害で公表時期が違うので別々に持つ） |
| `.github/workflows/update-data.yml` | データの自動更新（GitHub Actions） |

## データの更新

公表データは年2回更新される（介護：6月末・12月末時点、障害：3月末・9月末時点）。
GitHub Actions の「事業所データの更新」が公表時期に合わせて自動で取り直し、
変わっていればコミットする。Vercel がそれを見て公開し直す。

手で取り直すとき：GitHub の **Actions → 事業所データの更新 → Run workflow**。
公表ページの作りが変わって自動で見つからなかったときは、ログに出る URL か、
自分で見つけた CSV / ZIP の URL を入力欄に貼って実行する。

手元で動かすとき：

```bash
npm install
npm run data                         # 公表ページから最新を取得
npm run data -- --file 訪問介護.csv   # 手元のファイル（CSV / ZIP）を読む
npm run data -- --rebuild            # data/rows/ から offices.json だけ作り直す
npm run dev                          # http://localhost:3000
```

## 確認

```bash
npm test          # 読み取り・まとめ・URL拾いのテスト
npm run typecheck
npm run lint
npm run build
```

## 出典

- 介護サービス情報公表システム（厚生労働省）オープンデータ … https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html
- 障害福祉サービス等情報公表システム（WAM NET）オープンデータ … https://www.wam.go.jp/content/wamnet/pcpub/top/sfkopendata/
- 地図：Esri World Light Gray Base（白地図）、国土地理院 地理院タイル（淡色地図）
