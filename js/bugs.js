/* プロブレムガーデン - 虫（放置シグナル）の派生計算
 * 虫の数はデータに持たない。last_updated からの経過日数による描画時の派生値。
 * バックエンド・定期実行を不要にするための設計。
 */
window.PG = window.PG || {};

// last_updated（"YYYY-MM-DD" もしくは ISO文字列）からの経過日数（0以上の整数）
PG.daysSince = function (dateStr) {
  if (!dateStr) return 0;
  const then = new Date(dateStr + (dateStr.length <= 10 ? "T00:00:00" : ""));
  if (isNaN(then.getTime())) return 0;
  const ms = Date.now() - then.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
};

// 経過日数 → 虫の数。
//   ・bugStartDays 未満: 0
//   ・以降は逓増（増分が徐々に大きくなる。上限なし）
// 仕様: 経過3日で1匹、以降逓増、上限なしで増え続ける。
PG.bugCount = function (days) {
  const start = PG.config.bugStartDays;
  if (days < start) return 0;
  const d = days - start;
  // d=0 → 1匹。二乗成分で増分が加速（逓増）。上限は設けない。
  return 1 + Math.floor(d + (d * d) / 16);
};

// プロジェクトの現在の虫数
PG.projectBugs = function (p) {
  // harvested は虫が湧かない（やり遂げた証拠）。composted はボール化済みなので庭には虫を出さない。
  if (!p || p.status === "harvested" || p.status === "composted") return 0;
  return PG.bugCount(PG.daysSince(p.last_updated));
};

// 群れ（雲）表現に切り替えるか
PG.isSwarm = function (bugs) {
  return bugs >= PG.config.swarmThreshold;
};
