// オフライン対応：アプリ本体はキャッシュしつつ裏で更新、辞書とフォントは一度取得したら再利用
const VERSION = 'v2';
const APP_CACHE = `emgeki-app-${VERSION}`;
const DATA_CACHE = 'emgeki-data-v1';
const APP_FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/util.js',
  'js/fonts.js',
  'js/furigana.js',
  'js/paginate.js',
  'js/proofread.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('emgeki-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isDict = url.pathname.includes('/vendor/');
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  if (isDict || isFont) {
    // 辞書・フォント：キャッシュ優先
    e.respondWith(caches.open(DATA_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin === location.origin) {
    // アプリ本体：キャッシュを返しつつ裏で最新を取得
    e.respondWith(caches.open(APP_CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
