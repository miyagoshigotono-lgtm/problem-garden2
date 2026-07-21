/* ローカル確認用の静的サーバ（依存なし）。本番はGitHub Pages。 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.PORT || 5173;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".webmanifest": "application/manifest+json",
};

http.createServer((req, res) => {
  // 確認用: canvasのdataURLを受け取りPNG保存（ローカル開発のみ）
  if (req.method === "POST" && req.url === "/__save") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const b64 = body.split("base64,")[1] || body;
        fs.writeFileSync(path.join(require("os").tmpdir(), "garden_shot.png"), Buffer.from(b64, "base64"));
        res.writeHead(200); res.end("ok");
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return;
  }
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("404"); return;
  }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log("serving http://localhost:" + PORT));
