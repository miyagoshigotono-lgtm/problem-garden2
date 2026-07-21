/* プロブレムガーデン - 設定
 * GitHubの向き先はここで一元管理する。PATはここには絶対に書かない（localStorageに保存）。
 */
window.PG = window.PG || {};

PG.config = {
  // ==== GitHub リポジトリ（自分のものに書き換える）====
  owner: "YOUR_GITHUB_USER",
  repo: "problem-garden",
  branch: "main",
  dataPath: "data/garden.json",

  // raw URL（Pagesビルドのラグを避け、生JSONを直接fetch）。空なら owner/repo/branch から自動生成。
  rawUrl: "",

  // ==== アセット ====
  assetDir: "assets/",

  // ==== 虫（放置シグナル）チューニング ====
  bugStartDays: 3,      // これ未満は虫ゼロ
  swarmThreshold: 6,    // これ以上で「群れの雲」表現＋うなだれ

  // ==== 描画 ====
  swayAmplitude: 0.05,  // 揺れの最大回転(rad)
  swaySpeed: 0.0012,    // 揺れ速度
};

// raw URL 自動生成
PG.rawDataUrl = function () {
  const c = PG.config;
  if (c.rawUrl) return c.rawUrl;
  return `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/${c.dataPath}`;
};
