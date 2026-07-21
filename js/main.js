/* プロブレムガーデン - ブートストラップ
 * データ読込 → アセット読込 → 庭起動 → クリック配線 → 設定/追加UI。
 */
window.PG = window.PG || {};

(async function () {
  const canvas = document.getElementById("garden");

  PG.assets.load();
  PG.garden.init(canvas);
  PG.sidebar.init({ onChange: () => PG.garden.refreshData() });

  await PG.data.load();
  PG.garden.refreshData();
  PG.garden.start();

  // ---- クリック→フォーカス ----
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const hit = PG.garden.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) PG.sidebar.open(hit);
    else PG.sidebar.close();
  });

  // ---- 設定（PAT）----
  const settings = document.getElementById("settings");
  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("pat-input").value = PG.data.getPat();
    settings.classList.add("open");
  });
  document.getElementById("settings-close").addEventListener("click", () => settings.classList.remove("open"));
  document.getElementById("pat-save").addEventListener("click", () => {
    PG.data.setPat(document.getElementById("pat-input").value);
    settings.classList.remove("open");
  });
  document.getElementById("pat-clear").addEventListener("click", () => {
    PG.data.setPat("");
    document.getElementById("pat-input").value = "";
  });
  document.getElementById("btn-reload").addEventListener("click", async () => {
    await PG.data.load();
    PG.garden.refreshData();
  });

  // ---- 新しい種を植える（簡易・大きい入力）----
  const addM = document.getElementById("add-modal");
  document.getElementById("btn-add").addEventListener("click", () => addM.classList.add("open"));
  document.getElementById("add-cancel").addEventListener("click", () => addM.classList.remove("open"));
  document.getElementById("add-confirm").addEventListener("click", async () => {
    const name = document.getElementById("add-name").value.trim();
    if (!name) { document.getElementById("add-name").focus(); return; }
    const type = document.querySelector('input[name="ptype"]:checked').value;
    const id = "p" + Date.now().toString(36);
    const today = PG.data.today();
    PG.data.getState().projects.push({
      id, name, status: "seed", growth_stage: 0, plant_type: type,
      current_note: "", problems: [], lesson: null,
      created_at: today, last_updated: today, harvested_at: null, composted_at: null,
    });
    PG.garden.refreshData();
    document.getElementById("add-name").value = "";
    addM.classList.remove("open");
    if (PG.data.hasPat()) {
      try { await PG.data.save("garden: 新しい種 " + name); } catch (e) { alert("保存失敗: " + e.message); }
    }
  });

  // ---- Service Worker ----
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); } catch (e) { /* 非対応でも動く */ }
  }
})();
