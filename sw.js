/* プロブレムガーデン - Service Worker
 * アプリ殻はキャッシュ（オフラインでも起動）。
 * ただし garden.json は network-first（Pagesビルドのラグと鮮度を優先）。
 */
const CACHE = "pg-shell-v1";
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/config.js",
  "./js/bugs.js",
  "./js/assets.js",
  "./js/data.js",
  "./js/garden.js",
  "./js/sidebar.js",
  "./js/main.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // garden.json（ローカル/raw どちらも）は常にネット優先・キャッシュしない
  const isData = url.pathname.endsWith("garden.json") || url.hostname === "raw.githubusercontent.com";
  // GitHub API はSWを素通し
  const isApi = url.hostname === "api.github.com";

  if (isApi) return; // 介入しない

  if (isData) {
    e.respondWith(
      fetch(e.request, { cache: "no-store" }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 殻: cache-first、無ければネット
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      // 同一オリジンの静的資産は動的キャッシュ
      if (res.ok && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
