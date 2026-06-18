const CACHE = 'studyvault-v2';
const SHELL = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500&display=swap'
];

// Install — cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fall back to cache; for Firebase/CDN libs always go network
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always go network for Firebase (auth, Firestore, functions) and the
  // React/Babel CDN scripts used to render uploaded JSX/TSX materials.
  if (
    url.includes('firebaseapp.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit') ||
    url.includes('unpkg.com')
  ) {
    return; // let browser handle normally
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful GET responses
        if (e.request.method === 'GET' && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => cached || offlinePage()))
  );
});

function offlinePage() {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>StudyVault — Offline</title>
<style>
  body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f3ef;color:#1a1a2e;text-align:center;padding:2rem;}
  .icon{font-size:3rem;margin-bottom:1rem;}
  h1{font-size:1.4rem;margin-bottom:.5rem;}
  p{color:#7a7a9d;font-size:.9rem;line-height:1.6;max-width:300px;}
  button{margin-top:1.5rem;background:#6d5ef9;color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:.9rem;font-weight:500;cursor:pointer;}
</style>
</head>
<body>
  <div class="icon">📶</div>
  <h1>You're offline</h1>
  <p>StudyVault needs an internet connection to load your materials. Please check your connection and try again.</p>
  <button onclick="location.reload()">Try Again</button>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
