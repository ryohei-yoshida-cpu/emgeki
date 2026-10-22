// オフライン対応：アプリ本体はネット優先（オフライン時はキャッシュ）、辞書とフォントは一度取得したら再利用
const VERSION = 'v15';
const APP_CACHE = `emgeki-app-${VERSION}`;
const DATA_CACHE = 'emgeki-data-v1';
const APP_FILES = [
  './',
  'index.html',
  'guide.html',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/util.js',
  'js/fonts.js',
  'js/furigana.js',
  'js/paginate.js',
  'js/proofread.js',
  'js/export.js',
  'js/pdfstore.js',
  'js/pdfjs.js',
  'js/pdfparse.js',
  'js/speakers.js',
  'js/textparse.js',
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

// Android：LINE などの共有メニューから送られたファイルを受け取り、アプリに渡す
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const cache = await caches.open('emgeki-share');
    if (file && typeof file !== 'string') {
      await cache.put('shared-file', new Response(file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'shared.txt') },
      }));
    } else if (form.get('text')) {
      // ファイルではなく文字だけが共有されたときはテキストとして扱う
      await cache.put('shared-file', new Response(String(form.get('text')), {
        headers: { 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent(`${form.get('title') || '共有された脚本'}.txt`) },
      }));
    }
  } catch { /* 受け取れなかったときは、アプリ側で「見つかりません」と知らせる */ }
  return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
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
    // アプリ本体：つながっていれば常に最新、オフラインならキャッシュ
    e.respondWith(caches.open(APP_CACHE).then(async (c) => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch {
        const hit = await c.match(req, { ignoreSearch: true });
        return hit || Response.error();
      }
    }));
  }
});
