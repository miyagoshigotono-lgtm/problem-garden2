# プロブレムガーデン

放置されたプロジェクトを「荒れた庭」として可視化し、一つずつ終わらせるための個人用ツール。
素のHTML+CSS+JS+Canvas。フレームワーク・ビルド不要。GitHub Pagesに置くだけで動く。

状態はすべて絵で伝える（背丈・実・虫・ボールの山）。**数値・％・日数はUIに一切出さない。**

## 4状態

- **seed（種）** — 構想のみ。虫は湧く。
- **growing（成長中）** — 着手済み。`growth_stage` 1〜5で見た目が変わる。
- **harvested（収穫）** — 完成。収穫棚に常設表示。
- **composted（堆肥）** — 意図的撤退。コンポスト枠にボール化。**教訓（lesson）必須。**

虫は `last_updated` からの経過日数の派生値（データに持たない）。3日で1匹、以降は上限なく逓増。
6匹以上で「群れの雲＋うなだれ」表現に切り替わる（データ上は無限、見た目だけ段階飽和）。

## ファイル構成

```
index.html            庭本体
css/style.css
js/config.js          リポジトリ向き先・チューニング（PATはここに書かない）
js/bugs.js            虫の派生計算
js/assets.js          画像読込＋プレースホルダーフォールバック
js/data.js            garden.json読込（network-first）＋GitHub Contents API書込
js/garden.js          Canvasエンジン（区画・揺れ・虫・棚・コンポスト）
js/sidebar.js         フォーカス＋サイドバー＋編集操作
js/main.js            起動・設定・種の追加
data/garden.json      データ本体（1ファイル）
assets/               透過PNG 16枚＋アイコン（scripts/extract-assets.jsで生成済み）
manifest.webmanifest / sw.js   PWA
scripts/              extract-assets.js（画像切り出し）, serve.js（ローカル確認用）
```

## セットアップ

1. このフォルダを公開リポジトリとしてGitHubへ push。
2. `js/config.js` の `owner` / `repo` / `branch` を自分の値に書き換える。
3. リポジトリの Settings → Pages でブランチを公開。
4. 書き込みを使うなら、**このリポジトリ限定・Contents (Read/Write) のみ**の
   Fine-grained PAT を発行し、アプリ右上の ⚙ から貼る（端末内 localStorage のみに保存）。

## 表示先

- **ブラウザ全画面**（サブモニタ／ミニPC常駐）: PagesのURLを開くだけ。
- **Lively Wallpaper**: PagesのURLをそのまま食わせる。非表示時はrAFを停止するため低負荷。

## ローカル確認

```
node scripts/serve.js      # http://localhost:5173
```

> 注: Service Workerが殻（HTML/CSS/JS）をキャッシュする。コードを編集して反映されない時は
> ブラウザでSW登録解除＋キャッシュ削除、または `sw.js` の `CACHE` 名（`pg-shell-v1`）を上げる。

## 画像アセット

`assets/` の16枚は `scripts/extract-assets.js` が、リポジトリ直下の4枚のスプライトシート
（`ChatGPT Image *.png`）から切り出し済み（背景除去＋オートクロップ、依存なし・Node標準のみ）。
差し替える場合は同名の透過PNGを置くだけ。画像が無くてもCanvasの仮絵で動く。

再生成:
```
node scripts/extract-assets.js
```

## 設計上の禁止事項（変更不可）

- 数値・％・日数のUI表示禁止。
- 解決策の自動提案・表示禁止（問題点の列挙まで）。
- 荒れの緩和調整（虫の上限・放置の非表示化）禁止。
- 本書にない機能の先行実装禁止。
