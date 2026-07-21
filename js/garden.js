/* プロブレムガーデン - Canvas 庭エンジン
 * 1画面＝1つの箱庭。区画配置・プレースホルダー描画・sin波揺れ・虫・収穫棚・コンポスト。
 * 低CPU: requestAnimationFrame、非表示時は停止。数値・日数・％は一切描かない。
 */
window.PG = window.PG || {};

PG.garden = (function () {
  let canvas, ctx;
  let W = 0, H = 0, dpr = 1;
  let running = false, rafId = 0;
  let startTs = 0, nowT = 0;
  let focusId = null;
  let hits = [];            // クリック判定用の矩形
  let compostBalls = [];    // 積み上がるボール（永続）
  let anims = [];           // 進行中アニメ（堆肥化の転がり込み等）

  // ---------- 初期化 ----------
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    // 非表示時は停止（Lively壁紙で24時間常駐しても低負荷を保つ）
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 常時フルスクリーン。clientWidthはレイアウト前に0になり得るためinnerWidthを優先。
    W = window.innerWidth || canvas.clientWidth;
    H = window.innerHeight || canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildCompost();
  }

  // ---------- ループ ----------
  function start() {
    if (running) return;
    running = true;
    startTs = 0;
    render(); // 初回は即描画（rAFの初回発火が遅れても静止画は出る）
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function frame(ts) {
    if (!running) return;
    if (!startTs) startTs = ts;
    nowT = ts - startTs;
    // サイズが未確定(0)や変化した場合は自動補正（resizeイベントが来ない環境・回転対策）
    if (W !== window.innerWidth || H !== window.innerHeight) {
      if (window.innerWidth && window.innerHeight) resize();
    }
    stepAnims();
    render();
    rafId = requestAnimationFrame(frame);
  }

  // ---------- レイアウト ----------
  function groundY() { return Math.round(H * 0.70); }

  function activeProjects() {
    return PG.data.getState().projects.filter(
      (p) => p.status === "seed" || p.status === "growing"
    );
  }
  function harvestedProjects() {
    return PG.data.getState().projects.filter((p) => p.status === "harvested");
  }
  function compostedProjects() {
    return PG.data.getState().projects.filter((p) => p.status === "composted");
  }

  // 区画（畑）の座標。コード側で管理。中央のグラウンド帯に横並び、幅で折り返し。
  function plotLayout() {
    const list = activeProjects();
    const gy = groundY();
    const marginL = Math.max(40, W * 0.06);
    const marginR = Math.max(40, W * 0.30); // 右側は収穫棚に譲る
    const usable = Math.max(200, W - marginL - marginR);
    const n = Math.max(1, list.length);
    const cell = Math.min(180, usable / Math.min(n, Math.max(1, Math.floor(usable / 150))));
    const perRow = Math.max(1, Math.floor(usable / cell));
    return list.map((p, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = marginL + cell / 2 + col * cell;
      const y = gy + row * 46; // 奥行きっぽく段
      return { p, x, y, cell };
    });
  }

  // ---------- 描画 ----------
  function render() {
    hits = [];
    drawBackground();
    drawShelf();
    drawCompostBin();

    const plots = plotLayout();
    // 奥（上）から手前（下）の順に描くと重なりが自然
    plots.sort((a, b) => a.y - b.y);
    for (const plot of plots) drawPlant(plot);

    // 収穫棚の成果物
    drawHarvestItems();
    // コンポストのボール
    drawCompostBalls();
    // 進行中アニメの前景
    drawAnims();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#3a4a34");
    g.addColorStop(0.6, "#42502f");
    g.addColorStop(1, "#2f3b26");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 地面
    const gy = groundY();
    const gg = ctx.createLinearGradient(0, gy - 20, 0, H);
    gg.addColorStop(0, "#5a4a33");
    gg.addColorStop(1, "#3d3222");
    ctx.fillStyle = gg;
    ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = "rgba(120,150,80,0.25)";
    ctx.fillRect(0, gy - 6, W, 10); // 草の帯
  }

  // 揺れ角（根元基準・sin波）
  function swayAngle(phase, droop) {
    const a = PG.config.swayAmplitude * Math.sin(nowT * PG.config.swaySpeed + phase);
    return a + (droop || 0);
  }

  function plantHeight() { return Math.min(150, Math.max(70, H * 0.22)); }

  function drawPlant(plot) {
    const p = plot.p;
    const x = plot.x, gy = plot.y;
    const bugs = PG.projectBugs(p);
    const swarm = PG.isSwarm(bugs);
    const dim = focusId && focusId !== p.id;

    // 土
    drawSoil(x, gy, 46, dim);

    const h = plantHeight() * (p.plant_type === "herb" ? 0.8 : 1);
    const phase = hashPhase(p.id);
    // 群れがたかると植物はうなだれる（右へ傾ぐ固定ドループ）
    const droop = swarm ? 0.28 : 0;

    ctx.save();
    ctx.translate(x, gy);
    ctx.rotate(swayAngle(phase, droop));
    ctx.globalAlpha = dim ? 0.4 : 1;

    let name = null;
    if (p.status === "seed") name = "seed";
    else {
      const stg = Math.min(5, Math.max(1, p.growth_stage || 1));
      name = (p.plant_type === "herb" ? "herb_" : "tree_") + stg;
    }
    const img = swarm ? (PG.assets.get("wilt") || PG.assets.get(name)) : PG.assets.get(name);

    let w;
    if (img) {
      const ratio = img.naturalWidth / img.naturalHeight;
      const dh = p.status === "seed" ? h * 0.35 : h;
      const dw = dh * ratio;
      ctx.drawImage(img, -dw / 2, -dh, dw, dh);
      w = dw;
    } else {
      w = drawPlantPlaceholder(p, h, swarm);
    }
    ctx.restore();

    // 虫（植物と一緒に回さない）。種は背丈が低いので実際の描画高さに合わせて虫を寄せる。
    const effH = p.status === "seed" ? h * 0.35 : h;
    drawBugs(x, gy, effH, bugs, swarm);

    // フォーカス枠
    if (focusId === p.id) drawFocusRing(x, gy - h / 2, Math.max(w, 70), h + 30);

    hits.push({ kind: "plant", id: p.id, x: x - 40, y: gy - h, w: 80, h: h + 20 });
  }

  function drawSoil(x, gy, r, dim) {
    ctx.save();
    ctx.globalAlpha = dim ? 0.5 : 1;
    ctx.fillStyle = "#4a3826";
    ctx.beginPath();
    ctx.ellipse(x, gy, r, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(x, gy + 3, r * 0.8, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // プレースホルダー植物（画像未着時）。根元=原点、上へ伸ばす。戻り値=幅の目安
  function drawPlantPlaceholder(p, h, swarm) {
    if (p.status === "seed") {
      ctx.fillStyle = "#8a6b3a";
      ctx.beginPath();
      ctx.ellipse(0, -6, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      return 24;
    }
    const stg = Math.min(5, Math.max(1, p.growth_stage || 1));
    const isHerb = p.plant_type === "herb";
    const th = h * (0.35 + stg * 0.13);
    const trunkW = Math.max(4, th * 0.06);

    // 幹/茎
    ctx.strokeStyle = isHerb ? "#5b8a3a" : "#8a6b43";
    ctx.lineWidth = trunkW;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -th * 0.7);
    ctx.stroke();

    // 葉/樹冠
    const crownY = -th * 0.72;
    const crownR = th * (isHerb ? 0.28 : 0.34) * (0.6 + stg * 0.12);
    ctx.fillStyle = swarm ? "#6f7a4a" : (isHerb ? "#6fae3f" : "#4f9d3a");
    ctx.beginPath();
    ctx.ellipse(0, crownY, crownR, crownR * (isHerb ? 0.7 : 1), 0, 0, Math.PI * 2);
    ctx.fill();
    // 実（stage5）/ 花（stage4）
    if (!swarm && stg >= 4) {
      ctx.fillStyle = stg >= 5 ? "#e0473a" : "#f4f4f4";
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * crownR * 0.5, crownY + Math.sin(a) * crownR * 0.4, crownR * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return crownR * 2;
  }

  // ---------- 虫 ----------
  function drawBugs(x, gy, h, bugs, swarm) {
    if (bugs <= 0) return;
    if (swarm) { drawSwarm(x, gy - h * 0.7, bugs); return; }
    // 1〜5匹は個別描画。植物の周囲にばらまく。
    const img = PG.assets.get("bug");
    for (let i = 0; i < bugs; i++) {
      const a = (i / bugs) * Math.PI * 2 + nowT * 0.0006 * (i % 2 ? 1 : -1);
      const rx = 34 + (i % 3) * 8;
      const ry = h * 0.4;
      const bx = x + Math.cos(a) * rx;
      const by = gy - h * 0.55 + Math.sin(a) * ry * 0.5 + Math.sin(nowT * 0.003 + i) * 3;
      if (img) {
        const s = 20;
        ctx.drawImage(img, bx - s / 2, by - s / 2, s, s);
      } else {
        drawBugPlaceholder(bx, by);
      }
    }
  }

  function drawBugPlaceholder(bx, by) {
    ctx.save();
    ctx.fillStyle = "#2b2b30";
    ctx.beginPath();
    ctx.ellipse(bx, by, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(200,220,255,0.7)"; // 羽
    ctx.beginPath(); ctx.ellipse(bx - 4, by - 4, 4, 3, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx + 4, by - 4, 4, 3, 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 6匹以上: 群れの雲
  function drawSwarm(cx, cy, bugs) {
    ctx.save();
    // もやっとした雲
    const cloudR = 30 + Math.min(40, (bugs - 5) * 3);
    ctx.fillStyle = "rgba(40,40,45,0.28)";
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * cloudR * 0.4, cy + Math.sin(a) * cloudR * 0.3, cloudR * 0.7, cloudR * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 蠢く点
    const dots = Math.min(24, bugs + 6);
    ctx.fillStyle = "rgba(20,20,25,0.9)";
    for (let i = 0; i < dots; i++) {
      const t = nowT * 0.004 + i * 1.7;
      const dx = Math.cos(t) * cloudR * (0.3 + (i % 3) * 0.25);
      const dy = Math.sin(t * 1.3) * cloudR * 0.4;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- 収穫棚 ----------
  function shelfRect() {
    const w = Math.min(360, W * 0.26);
    const h = Math.min(220, H * 0.34);
    return { x: W - w - Math.max(24, W * 0.03), y: Math.max(30, H * 0.10), w, h };
  }
  function drawShelf() {
    const r = shelfRect();
    const img = PG.assets.get("shelf");
    if (img) {
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else {
      // プレースホルダー棚（3段）
      ctx.save();
      ctx.strokeStyle = "#3a2c1a";
      ctx.lineWidth = 4;
      ctx.fillStyle = "#b98a4b";
      for (let i = 0; i < 3; i++) {
        const by = r.y + (i + 1) * (r.h / 3.2);
        ctx.fillRect(r.x, by, r.w, 12);
        ctx.strokeRect(r.x, by, r.w, 12);
      }
      // 支柱
      ctx.fillRect(r.x, r.y, 12, r.h);
      ctx.fillRect(r.x + r.w - 12, r.y, 12, r.h);
      ctx.restore();
    }
    // ラベル（数値ではない・棚の名札）
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("収穫棚", r.x + r.w / 2, r.y - 8);
  }
  function shelfSlots() {
    const r = shelfRect();
    const items = harvestedProjects();
    const rows = 3;
    const perRow = 3;
    return items.map((p, i) => {
      const row = Math.floor(i / perRow) % rows;
      const col = i % perRow;
      const by = r.y + (row + 1) * (r.h / 3.2);
      const x = r.x + 24 + col * ((r.w - 48) / perRow) + ((r.w - 48) / perRow) / 2;
      return { p, x, y: by, size: Math.min(56, r.w / 4) };
    });
  }
  function drawHarvestItems() {
    for (const slot of shelfSlots()) {
      const p = slot.p;
      const dim = focusId && focusId !== p.id;
      const name = (p.plant_type === "herb" ? "herb_5" : "tree_5");
      const img = PG.assets.get(name);
      const s = slot.size;
      ctx.save();
      ctx.globalAlpha = dim ? 0.45 : 1;
      if (img) {
        const ratio = img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, slot.x - (s * ratio) / 2, slot.y - s, s * ratio, s);
      } else {
        // 小さな実付きの成果物
        ctx.fillStyle = "#4f9d3a";
        ctx.beginPath(); ctx.arc(slot.x, slot.y - s * 0.5, s * 0.35, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#e0473a";
        ctx.beginPath(); ctx.arc(slot.x - 6, slot.y - s * 0.5, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(slot.x + 6, slot.y - s * 0.4, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      if (focusId === p.id) drawFocusRing(slot.x, slot.y - s * 0.5, s + 10, s + 10);
      hits.push({ kind: "harvested", id: p.id, x: slot.x - s / 2, y: slot.y - s, w: s, h: s });
    }
  }

  // ---------- コンポスト枠 ----------
  function compostRect() {
    const w = Math.min(230, W * 0.2);
    const h = Math.min(150, H * 0.22);
    return { x: Math.max(20, W * 0.03), y: H - h - Math.max(20, H * 0.04), w, h };
  }
  function drawCompostBin() {
    const r = compostRect();
    ctx.save();
    ctx.strokeStyle = "#4a3520";
    ctx.lineWidth = 5;
    ctx.fillStyle = "rgba(50,38,22,0.55)";
    // 枠（正面の板）
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x, r.y + r.h);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.lineTo(r.x + r.w, r.y);
    ctx.stroke();
    ctx.fillRect(r.x, r.y + r.h * 0.35, r.w, r.h * 0.65);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("コンポスト", r.x + r.w / 2, r.y - 6);
  }

  // 積み上げ位置を計算（簡易・落下＋積み重ねの近似）
  function rebuildCompost() {
    const r = compostRect();
    const list = compostedProjects();
    const ballR = Math.min(26, r.w / 6);
    const perRow = Math.max(2, Math.floor((r.w - ballR) / (ballR * 1.9)));
    const existing = {};
    compostBalls.forEach((b) => (existing[b.id] = b));
    compostBalls = list.map((p, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const rowCount = Math.min(perRow, list.length - row * perRow);
      const rowW = rowCount * ballR * 1.9;
      const x0 = r.x + (r.w - rowW) / 2 + ballR * 0.95;
      const tx = x0 + col * ballR * 1.9;
      const ty = r.y + r.h - ballR - row * ballR * 1.7;
      const prev = existing[p.id];
      return {
        id: p.id, r: ballR,
        x: prev ? prev.x : tx, y: prev ? prev.y : ty,
        tx, ty, settled: !!prev,
      };
    });
  }
  function drawCompostBalls() {
    const img = PG.assets.get("compost_ball");
    for (const b of compostBalls) {
      const dim = focusId && focusId !== b.id;
      ctx.save();
      ctx.globalAlpha = dim ? 0.5 : 1;
      if (img) {
        ctx.drawImage(img, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      } else {
        ctx.fillStyle = "#7a5a34";
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#8fae4a"; // 葉のかけら
        ctx.beginPath(); ctx.ellipse(b.x + b.r * 0.4, b.y - b.r * 0.3, 4, 2.5, 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
      if (focusId === b.id) drawFocusRing(b.x, b.y, b.r * 2 + 8, b.r * 2 + 8);
      hits.push({ kind: "composted", id: b.id, x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 });
    }
  }

  // ---------- 堆肥化の転がり込みアニメ ----------
  // plot座標から発生させ、ボールがポトンと落ちてバインに転がり込む
  function animateCompostDrop(id) {
    rebuildCompost();
    const target = compostBalls.find((b) => b.id === id);
    if (!target) return;
    // 元の畑位置を探す（既に status変更済みなので概算で上から落とす）
    const startX = target.tx;
    const startY = groundY() - plantHeight() * 0.5;
    target.x = startX; target.y = startY; target.settled = false;
    anims.push({
      type: "drop", id, vx: (target.tx - startX) * 0.02, vy: 0, g: 0.5, done: false,
    });
  }
  function stepAnims() {
    for (const a of anims) {
      if (a.type === "drop") {
        const b = compostBalls.find((x) => x.id === a.id);
        if (!b) { a.done = true; continue; }
        a.vy += a.g;
        b.y += a.vy;
        b.x += (b.tx - b.x) * 0.08; // 横に転がり込む
        if (b.y >= b.ty) {
          b.y = b.ty; a.vy *= -0.35; // バウンド
          if (Math.abs(a.vy) < 1.2) { b.y = b.ty; b.x = b.tx; b.settled = true; a.done = true; }
        }
      }
    }
    anims = anims.filter((a) => !a.done);
  }
  function drawAnims() { /* ボールはdrawCompostBallsで描画済み */ }

  // ---------- 共通 ----------
  function drawFocusRing(cx, cy, w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,236,150,0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -nowT * 0.02;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2 + 6, h / 2 + 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  function hashPhase(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
    return (h / 1000) * Math.PI * 2;
  }

  // ---------- 公開API ----------
  function hitTest(px, py) {
    // 後に描いた（手前の）ものを優先
    for (let i = hits.length - 1; i >= 0; i--) {
      const r = hits[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r;
    }
    return null;
  }
  function setFocus(id) { focusId = id; }
  function refreshData() { rebuildCompost(); }

  return {
    init, start, stop, resize,
    hitTest, setFocus, refreshData, animateCompostDrop,
  };
})();
