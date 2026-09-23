// ═══════════════════════════════════════════════════════════
//  Chapter Kit service worker
//  Network-first with a cache fallback, so a deploy is picked up
//  immediately but the app still opens on a flaky connection.
// ═══════════════════════════════════════════════════════════
const CACHE = 'chapterkit-v14';

const SHELL = [
  './',
  'index.html',
  'library.html',
  'store.html',
  'material.html',
  'cart.html',
  'checkout.html',
  'orders.html',
  'request.html',
  'viewer.html',
  'admin.html',
  'manifest.json',
  'icon-192.png',
  'og-image.png',
  'assets/css/app.css',
  'assets/js/config.js',
  'assets/js/firebase.js',
  'assets/js/ui.js',
  'assets/js/session.js',
  'assets/js/content.js',
  'assets/js/render.js',
  'assets/js/cart.js',
  'assets/js/orders.js',
  'assets/js/requests.js',
  'assets/js/images.js'
];

// Hosts that must always hit the network: auth, database, and the CDN
// libraries the sandboxed viewer loads (React/Babel for JSX, pdf.js for
// PDFs) plus the origins remote PDFs are fetched from.
const PASSTHROUGH = [
  'firebaseapp.com',
  'googleapis.com',
  'gstatic.com',
  'identitytoolkit',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'api.github.com',
  'raw.githubusercontent.com'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Add individually: one 404 shouldn't fail the whole install.
    await Promise.all(SHELL.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;

  if (req.method !== 'GET') return;
  if (PASSTHROUGH.some(h => req.url.includes(h))) return;

  // Same-origin only; anything else is left to the browser.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
      }
      return res;
    } catch (_) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      return offlinePage();
    }
  })());
});

function offlinePage() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chapter Kit — Offline</title>
<style>
 body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;
 justify-content:center;min-height:100vh;margin:0;background:#f6f7fb;color:#161726;
 text-align:center;padding:2rem;}
 .icon{font-size:3rem;margin-bottom:1rem}
 h1{font-size:1.3rem;margin:0 0 .5rem}
 p{color:#8587a0;font-size:.9rem;line-height:1.6;max-width:300px;margin:0}
 button{margin-top:1.5rem;background:#6d5ef9;color:#fff;border:none;border-radius:10px;
 padding:12px 24px;font-size:.9rem;font-weight:500;cursor:pointer}
</style></head><body>
 <div class="icon">📶</div>
 <h1>You're offline</h1>
 <p>Chapter Kit needs a connection to load your materials. Check your network and try again.</p>
 <button onclick="location.reload()">Try again</button>
</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
