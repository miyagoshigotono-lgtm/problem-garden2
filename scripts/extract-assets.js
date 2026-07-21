/* プロブレムガーデン - 画像アセット切り出し（依存なし・Node標準のzlibのみ）
 * 4枚の背景付きスプライトシートを、16枚の透過PNGへ切り出す。
 *   - PNGを手書きデコード/エンコード（8bit, colorType 2/6, 非インターレース）
 *   - 各スプライトを列で分割 → 縁からのflood-fillで背景除去 → 不透明領域でオートクロップ
 * さらに manifest 用の icon-192 / icon-512 を生成。
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "assets");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ---------- PNG デコード ----------
function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error("PNGでない");
  let pos = 8;
  let width, height, bitDepth, colorType, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("bitDepth=8のみ対応: " + bitDepth);
  if (interlace) throw new Error("インターレース非対応");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error("colorType 2/6のみ対応: " + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let ri = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[ri++];
    const line = raw.slice(ri, ri + stride); ri += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 255; break;
        }
        default: throw new Error("filter?" + filter);
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }

  // RGBA へ正規化
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (channels === 4) {
      rgba[i * 4] = out[i * 4]; rgba[i * 4 + 1] = out[i * 4 + 1];
      rgba[i * 4 + 2] = out[i * 4 + 2]; rgba[i * 4 + 3] = out[i * 4 + 3];
    } else {
      rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1];
      rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255;
    }
  }
  return { width, height, data: rgba };
}

// ---------- PNG エンコード（RGBA, filter 0）----------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(img) {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 背景除去（縁からのflood-fill）----------
function luma(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
function sat(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

// 縁から流し込み、暗い輪郭線で止まる背景除去（シート全体に適用）。
// 各スプライトは太い暗色の輪郭線で完全に囲まれているため、内部の色（緑の樹冠等）は
// 縁から到達できず保持される。囲みの外＝背景だけが透明化される。
function removeBackground(img) {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const bg = new Uint8Array(N); // 1=背景(透明化)
  const stack = [];
  const DARKSTOP = 72; // これより暗い画素で流し込みを止める（＝輪郭線・濃い影）

  const lumaAt = (i) => luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (bg[i]) return;
    if (lumaAt(i) < DARKSTOP) return; // 輪郭線に当たったら止める（囲みの内側へ入らない）
    bg[i] = 1; stack.push(i);
  };
  for (let x = 0; x < W; x++) { visit(x, 0); visit(x, H - 1); }
  for (let y = 0; y < H; y++) { visit(0, y); visit(W - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i / W) | 0;
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
  }
  // 透明化
  for (let i = 0; i < N; i++) {
    if (bg[i]) data[i * 4 + 3] = 0;
  }
  // 1pxの縁を軽く柔らかく
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (data[i * 4 + 3] === 0) continue;
      let bgN = 0;
      if (x > 0 && data[(i - 1) * 4 + 3] === 0) bgN++;
      if (x < W - 1 && data[(i + 1) * 4 + 3] === 0) bgN++;
      if (y > 0 && data[(i - W) * 4 + 3] === 0) bgN++;
      if (y < H - 1 && data[(i + W) * 4 + 3] === 0) bgN++;
      if (bgN >= 2) data[i * 4 + 3] = 150;
    }
  }
  return img;
}

// ---------- オートクロップ（不透明領域＋余白）----------
function autocrop(img, pad) {
  const { width: W, height: H, data } = img;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return img; // 全透明
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);
  const nw = maxX - minX + 1, nh = maxY - minY + 1;
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const si = ((y + minY) * W + (x + minX)) * 4;
      const di = (y * nw + x) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return { width: nw, height: nh, data: out };
}

// ---------- 矩形クロップ ----------
function cropRect(img, x0, y0, w, h) {
  const { width: W, data } = img;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y + y0) * W + (x + x0)) * 4;
      const di = (y * w + x) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return { width: w, height: h, data: out };
}

// 不透明画素の連結成分を検出（4連結）。小さなゴミは面積で除外。
function connectedComponents(img, minArea) {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const label = new Int32Array(N).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < N; s++) {
    if (label[s] !== -1 || data[s * 4 + 3] <= 16) continue;
    const id = comps.length;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
    label[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i / W) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const nb = [i + 1, i - 1, i + W, i - W];
      const nx = [x + 1, x - 1, x, x];
      const ny = [y, y, y + 1, y - 1];
      for (let k = 0; k < 4; k++) {
        if (nx[k] < 0 || ny[k] < 0 || nx[k] >= W || ny[k] >= H) continue;
        const j = nb[k];
        if (label[j] === -1 && data[j * 4 + 3] > 16) { label[j] = id; stack.push(j); }
      }
    }
    comps.push({ minX, minY, maxX, maxY, area });
  }
  return comps.filter((c) => c.area >= minArea);
}

// シート全体の背景を除去 → 連結成分でスプライトを分離 → 左→右順に名前を割当。
function extractSprites(img, names) {
  removeBackground(img);
  let comps = connectedComponents(img, 400);
  // 面積上位から必要数を採用（細かなゴミを排除）→ 左端座標で並べ替え
  comps.sort((a, b) => b.area - a.area);
  comps = comps.slice(0, names.length);
  comps.sort((a, b) => a.minX - b.minX);
  if (comps.length !== names.length) {
    console.warn(`  警告: 検出 ${comps.length} / 期待 ${names.length}（[${names.join(",")}]）`);
  }
  const pad = 8;
  return comps.map((c, i) => {
    const x0 = Math.max(0, c.minX - pad), y0 = Math.max(0, c.minY - pad);
    const x1 = Math.min(img.width - 1, c.maxX + pad), y1 = Math.min(img.height - 1, c.maxY + pad);
    return { name: names[i] || "extra_" + i, img: cropRect(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1) };
  });
}

// ---------- 実行 ----------
function findSheets() {
  const files = fs.readdirSync(ROOT).filter((f) => /^ChatGPT Image.*\.png$/i.test(f)).sort();
  if (files.length < 4) throw new Error("スプライトシートが4枚見つからない: " + files.length);
  return files.map((f) => path.join(ROOT, f));
}

function main() {
  const sheets = findSheets();
  console.log("入力:", sheets.map((s) => path.basename(s)));

  // 並び（ファイル名昇順）: trees, herbs, icons(bug/weed/wilt/seed), shelf/ball
  const imgs = sheets.map((s) => decodePNG(fs.readFileSync(s)));
  console.log("寸法:", imgs.map((i) => i.width + "x" + i.height).join(", "));

  const pieces = [];
  pieces.push(...extractSprites(imgs[0], ["tree_1", "tree_2", "tree_3", "tree_4", "tree_5"]));
  pieces.push(...extractSprites(imgs[1], ["herb_1", "herb_2", "herb_3", "herb_4", "herb_5"]));
  pieces.push(...extractSprites(imgs[2], ["bug", "weed", "wilt", "seed"]));
  pieces.push(...extractSprites(imgs[3], ["shelf", "compost_ball"]));

  for (const p of pieces) {
    const file = path.join(OUT, p.name + ".png");
    fs.writeFileSync(file, encodePNG(p.img));
    console.log("書出:", p.name + ".png", p.img.width + "x" + p.img.height);
  }

  // アイコン生成（tree_5 を正方形の背景に載せる）
  makeIcon(pieces.find((p) => p.name === "tree_5").img, 192, path.join(OUT, "icon-192.png"));
  makeIcon(pieces.find((p) => p.name === "tree_5").img, 512, path.join(OUT, "icon-512.png"));
  console.log("完了");
}

// 単色背景の正方アイコンにスプライトを中央配置
function makeIcon(sprite, size, outPath) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 0x2f; data[i * 4 + 1] = 0x3b; data[i * 4 + 2] = 0x26; data[i * 4 + 3] = 255;
  }
  // sprite を最大80%で中央にニアレスト縮小
  const scale = Math.min((size * 0.8) / sprite.width, (size * 0.8) / sprite.height);
  const dw = Math.round(sprite.width * scale), dh = Math.round(sprite.height * scale);
  const ox = Math.round((size - dw) / 2), oy = Math.round((size - dh) / 2);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sprite.width - 1, Math.floor(x / scale));
      const sy = Math.min(sprite.height - 1, Math.floor(y / scale));
      const si = (sy * sprite.width + sx) * 4;
      const a = sprite.data[si + 3] / 255;
      if (a <= 0) continue;
      const di = ((y + oy) * size + (x + ox)) * 4;
      data[di] = sprite.data[si] * a + data[di] * (1 - a);
      data[di + 1] = sprite.data[si + 1] * a + data[di + 1] * (1 - a);
      data[di + 2] = sprite.data[si + 2] * a + data[di + 2] * (1 - a);
      data[di + 3] = 255;
    }
  }
  fs.writeFileSync(outPath, encodePNG({ width: size, height: size, data }));
}

main();
