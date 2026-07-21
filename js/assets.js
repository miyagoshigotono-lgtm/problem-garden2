/* プロブレムガーデン - 画像アセット読み込み（プレースホルダー・フォールバック）
 * 画像未着でも動くこと。読み込めた画像だけ使い、無ければ Canvas 仮絵で描く。
 */
window.PG = window.PG || {};

PG.assets = (function () {
  const names = [
    "tree_1", "tree_2", "tree_3", "tree_4", "tree_5",
    "herb_1", "herb_2", "herb_3", "herb_4", "herb_5",
    "bug", "weed", "wilt", "shelf", "compost_ball", "seed",
  ];

  const images = {}; // name -> {img, ready}

  function load() {
    names.forEach((name) => {
      const rec = { img: new Image(), ready: false };
      images[name] = rec;
      rec.img.onload = function () {
        // 実体のある画像のみ ready（幅0の壊れ画像は弾く）
        if (rec.img.naturalWidth > 0) rec.ready = true;
      };
      rec.img.onerror = function () { rec.ready = false; };
      rec.img.src = PG.config.assetDir + name + ".png";
    });
  }

  // 使える画像なら <img> を返す。無ければ null（呼び出し側がプレースホルダー描画）。
  function get(name) {
    const rec = images[name];
    return rec && rec.ready ? rec.img : null;
  }

  return { load, get, names };
})();
