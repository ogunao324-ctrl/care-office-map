@AGENTS.md

## このリポジトリについて

自社（千葉市花見川区浪花町）の周辺の居宅介護支援・訪問介護・障害福祉の事業所を、
地図と距離順の一覧で探すアプリ。つむぐ（tsumugu-board）とは別アプリだが、
構成（Next.js・Leaflet・地理院タイル・Vercel）と検索の寄せ方はつむぐに揃えている。
全体像は `README.md`。

## 運用ルール

- **ユーザーへの返答・報告・質問はすべて日本語で書く**（つむぐと同じ）。
  コマンド・ファイル名・コードはそのままでよいが、説明の文は日本語にする。
- `public/data/offices.json` と `data/rows/` は **手で書き換えない**。
  `npm run data`（または GitHub Actions の「事業所データの更新」）で作る。
- 検索・絞り込みの当たり判定は `src/lib/search-text.ts` の `searchKey` を通す。
  つむぐの `src/lib/domain/search-text.ts` の写しなので、変えるときは両方揃える。
- 地図タイルなど外部ホストを足したら、`next.config.ts` の CSP にも足す。
- 出すのは `npm test`・型チェック・ビルドが通ったものだけ。
