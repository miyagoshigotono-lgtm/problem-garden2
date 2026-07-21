/* プロブレムガーデン - フォーカス＋サイドバー
 * 対象をクリック→フォーカス→スライドイン。問題点の列挙が核。解決策は一切表示しない。
 * 数値・日数・％は出さない（堆肥化時期の日付のみ仕様で明示的に表示）。
 */
window.PG = window.PG || {};

PG.sidebar = (function () {
  let el, bodyEl, titleEl;
  let currentId = null;
  let onChange = null; // データ変更後に呼ぶ（garden再構築など）

  function init(opts) {
    el = document.getElementById("sidebar");
    titleEl = document.getElementById("sb-title");
    bodyEl = document.getElementById("sb-body");
    onChange = opts && opts.onChange;
    document.getElementById("sb-close").addEventListener("click", close);
  }

  function open(hit) {
    currentId = hit.id;
    PG.garden.setFocus(hit.id);
    render();
    el.classList.add("open");
  }
  function close() {
    currentId = null;
    PG.garden.setFocus(null);
    el.classList.remove("open");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function render() {
    const p = PG.data.project(currentId);
    if (!p) { close(); return; }
    titleEl.textContent = p.name;

    if (p.status === "composted") return renderComposted(p);
    if (p.status === "harvested") return renderHarvested(p);
    return renderPlant(p);
  }

  // ---- 植物（seed / growing）----
  function renderPlant(p) {
    const probs = p.problems || [];
    const rows = probs.map((pr) => `
      <li class="prob ${pr.resolved ? "done" : ""}">
        <label>
          <input type="checkbox" data-pid="${esc(pr.id)}" ${pr.resolved ? "checked" : ""}>
          <span>${esc(pr.text)}</span>
        </label>
      </li>`).join("");

    const isSeed = p.status === "seed";

    bodyEl.innerHTML = `
      <section class="sb-sec">
        <div class="sb-label">現在地</div>
        <div class="sb-note-row">
          <input id="sb-note" class="sb-input" type="text" value="${esc(p.current_note)}"
                 placeholder="例：配線完了、防水で停滞中">
          <button id="sb-note-save" class="mini">保存</button>
        </div>
      </section>

      <section class="sb-sec">
        <div class="sb-label">停滞理由（問題点）</div>
        <ul class="prob-list">${rows || '<li class="empty">（まだ無し）</li>'}</ul>
        <div class="sb-note-row">
          <input id="sb-newprob" class="sb-input" type="text" placeholder="問題点を追加">
          <button id="sb-addprob" class="mini">追加</button>
        </div>
      </section>

      <section class="sb-sec">
        <div class="sb-label">操作</div>
        <div class="btn-grid">
          ${isSeed
            ? `<button id="op-sprout" class="op">芽を出す（着手）</button>`
            : `<button id="op-grow" class="op">育てる</button>
               <button id="op-shrink" class="op ghost">戻す</button>`}
          <button id="op-harvest" class="op harvest">収穫する</button>
          <button id="op-compost" class="op compost">堆肥にする…</button>
        </div>
        <div id="compost-panel" class="compost-panel hidden">
          <div class="sb-label">教訓（必須）</div>
          <textarea id="lesson-text" class="sb-input" rows="2"
                    placeholder="この撤退から得た一行"></textarea>
          <div class="btn-grid">
            <button id="op-compost-confirm" class="op compost">コンポストへ転がす</button>
            <button id="op-compost-cancel" class="op ghost">やめる</button>
          </div>
        </div>
      </section>

      <div id="sb-status" class="sb-status"></div>
    `;

    // 現在地保存
    bodyEl.querySelector("#sb-note-save").addEventListener("click", async () => {
      p.current_note = bodyEl.querySelector("#sb-note").value.trim();
      PG.data.touch(p);
      await commit("現在地を更新");
    });

    // 問題点 追加
    bodyEl.querySelector("#sb-addprob").addEventListener("click", async () => {
      const inp = bodyEl.querySelector("#sb-newprob");
      const text = inp.value.trim();
      if (!text) return;
      p.problems = p.problems || [];
      p.problems.push({ id: "p" + Date.now().toString(36), text, resolved: false });
      PG.data.touch(p);
      await commit("問題点を追加");
    });

    // 問題点 解決チェック（trueにした時点で last_updated 更新＝虫が減る契機）
    bodyEl.querySelectorAll('input[type="checkbox"][data-pid]').forEach((cb) => {
      cb.addEventListener("change", async () => {
        const pr = (p.problems || []).find((x) => x.id === cb.dataset.pid);
        if (!pr) return;
        pr.resolved = cb.checked;
        PG.data.touch(p);
        await commit(cb.checked ? "問題点を解決" : "問題点を再オープン");
      });
    });

    // 成長操作
    if (isSeed) {
      bodyEl.querySelector("#op-sprout").addEventListener("click", async () => {
        p.status = "growing";
        p.growth_stage = Math.max(1, p.growth_stage || 1);
        PG.data.touch(p);
        await commit("着手（発芽）");
      });
    } else {
      bodyEl.querySelector("#op-grow").addEventListener("click", async () => {
        p.growth_stage = Math.min(5, (p.growth_stage || 1) + 1);
        PG.data.touch(p);
        await commit("成長");
      });
      bodyEl.querySelector("#op-shrink").addEventListener("click", async () => {
        p.growth_stage = Math.max(1, (p.growth_stage || 1) - 1);
        PG.data.touch(p);
        await commit("成長を戻す");
      });
    }

    // 収穫
    bodyEl.querySelector("#op-harvest").addEventListener("click", async () => {
      p.status = "harvested";
      p.growth_stage = 5;
      p.harvested_at = PG.data.today();
      PG.data.touch(p);
      await commit("収穫");
    });

    // 堆肥化（教訓必須）
    const panel = bodyEl.querySelector("#compost-panel");
    bodyEl.querySelector("#op-compost").addEventListener("click", () => panel.classList.remove("hidden"));
    bodyEl.querySelector("#op-compost-cancel").addEventListener("click", () => panel.classList.add("hidden"));
    bodyEl.querySelector("#op-compost-confirm").addEventListener("click", async () => {
      const lesson = bodyEl.querySelector("#lesson-text").value.trim();
      if (!lesson) {
        status("教訓は必須です（放置との区別のため）", true);
        bodyEl.querySelector("#lesson-text").focus();
        return;
      }
      p.status = "composted";
      p.lesson = lesson;
      p.composted_at = PG.data.today();
      PG.data.touch(p);
      const ok = await commit("堆肥化");
      if (ok !== false) {
        PG.garden.animateCompostDrop(p.id); // ポトンと転がり込むアニメ
        close();
      }
    });
  }

  // ---- 収穫棚の成果物 ----
  function renderHarvested(p) {
    bodyEl.innerHTML = `
      <section class="sb-sec">
        <div class="sb-badge harvest">収穫済み</div>
        <div class="sb-note">${esc(p.current_note) || "やり遂げた成果物。"}</div>
      </section>`;
  }

  // ---- 堆肥ボール ----
  function renderComposted(p) {
    bodyEl.innerHTML = `
      <section class="sb-sec">
        <div class="sb-badge compost">堆肥ボール</div>
        <div class="sb-label">教訓</div>
        <div class="sb-note lesson">${esc(p.lesson) || "（教訓なし）"}</div>
        <div class="sb-label">堆肥化した時期</div>
        <div class="sb-note">${esc(p.composted_at) || "—"}</div>
      </section>`;
  }

  // ---- 保存共通 ----
  function status(msg, isErr) {
    const s = document.getElementById("sb-status");
    if (s) { s.textContent = msg; s.className = "sb-status" + (isErr ? " err" : " ok"); }
  }
  async function commit(message) {
    if (onChange) onChange(); // 先に見た目を更新（楽観的）
    if (!PG.data.hasPat()) {
      status("ローカル変更のみ（PAT未設定で未保存）", true);
      render();
      return true;
    }
    status("保存中…", false);
    try {
      await PG.data.save("garden: " + message);
      status("保存しました", false);
    } catch (e) {
      status("保存失敗: " + e.message, true);
      render();
      return false;
    }
    render();
    return true;
  }

  return { init, open, close };
})();
