@AGENTS.md

## このリポジトリについて

自社（千葉市花見川区浪花町）の周辺の居宅介護支援・訪問介護・訪問看護・障害福祉の事業所を、
地図と距離順の一覧で探すアプリ。つむぐ（tsumugu-board）とは別アプリだが、
構成（Next.js・Leaflet・Vercel）、地図の見た目（白地図＋駅・区の名前）、検索の寄せ方はつむぐに揃えている。
全体像は `README.md`。

## 運用ルール

- **ユーザーへの返答・報告・質問はすべて日本語で書く**（つむぐと同じ）。
  コマンド・ファイル名・コードはそのままでよいが、説明の文は日本語にする。
- `public/data/*.json`（offices / history / areas / details）と `data/rows/`・`data/history/`・`data/details/` は **手で書き換えない**。
  `npm run data` / `npm run history` / `npm run population` / `npm run details`（または GitHub Actions の
  「事業所データの更新」「公表ページの詳細の取得」）で作る。
  厚労省・WAM NET・e-Stat・介護サービス情報公表システムにはクラウドのセッションからはつながらないので、取り直しは GitHub Actions に任せる。
- 公表ページの詳細（介護サービス情報公表システム）は、年2回・1ページずつ数秒おきに取る約束（2026-10-14、ユーザーと確認）。
  間隔を縮めたり、対象を10km圏の介護の事業所より広げたりしない。画面には出所を明記する。
- 検索・絞り込みの当たり判定は `src/lib/search-text.ts` の `searchKey` を通す。
  つむぐの `src/lib/domain/search-text.ts` の写しなので、変えるときは両方揃える。
- 地図タイルなど外部ホストを足したら、`next.config.ts` の CSP にも足す。
- 出すのは `npm test`・型チェック・ビルドが通ったものだけ。
