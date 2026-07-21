/* プロブレムガーデン - データ層
 * 読み: raw URL から garden.json を network-first で取得。
 * 書き: GitHub Contents API を直叩き。PAT は localStorage（コードにハードコードしない）。
 */
window.PG = window.PG || {};

PG.data = (function () {
  const PAT_KEY = "pg_github_pat";

  let state = { version: 1, projects: [] };

  // ---- PAT 管理 ----
  function getPat() { return localStorage.getItem(PAT_KEY) || ""; }
  function setPat(v) {
    if (v) localStorage.setItem(PAT_KEY, v.trim());
    else localStorage.removeItem(PAT_KEY);
  }
  function hasPat() { return !!getPat(); }

  // ---- 読み込み（network-first、失敗時はローカルの data/garden.json）----
  async function load() {
    const urls = [PG.rawDataUrl() + "?t=" + Date.now(), PG.config.dataPath + "?t=" + Date.now()];
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          state = await res.json();
          if (!Array.isArray(state.projects)) state.projects = [];
          return state;
        }
      } catch (e) { /* 次のURLへフォールバック */ }
    }
    return state; // 全滅時は空/前回値
  }

  function getState() { return state; }
  function project(id) { return state.projects.find((p) => p.id === id) || null; }

  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function touch(p) { p.last_updated = today(); }

  // ---- GitHub Contents API 書き込み ----
  // UTF-8 文字列 → base64
  function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }

  function apiUrl() {
    const c = PG.config;
    return `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.dataPath}`;
  }

  async function getSha() {
    const res = await fetch(apiUrl() + "?ref=" + PG.config.branch, {
      headers: {
        Authorization: "Bearer " + getPat(),
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
    });
    if (res.status === 404) return null; // 新規作成
    if (!res.ok) throw new Error("SHA取得失敗: " + res.status);
    const j = await res.json();
    return j.sha;
  }

  // 現在の state をコミット。成功で true。
  async function save(message) {
    if (!hasPat()) throw new Error("PAT未設定");
    const sha = await getSha();
    const content = utf8ToB64(JSON.stringify(state, null, 2) + "\n");
    const body = {
      message: message || "update garden",
      content,
      branch: PG.config.branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(apiUrl(), {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + getPat(),
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error("保存失敗: " + res.status + " " + t.slice(0, 200));
    }
    return true;
  }

  return {
    load, getState, project, save, touch, today,
    getPat, setPat, hasPat,
  };
})();
