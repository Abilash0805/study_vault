// ═══════════════════════════════════════════════════════════
//  Content renderers for the secure viewer.
//
//  Each returns a complete HTML document that is handed to a
//  sandboxed iframe via srcdoc. Nothing here trusts the content:
//  it runs isolated, and closing script tags are escaped so the
//  host page's parser can't be terminated early.
// ═══════════════════════════════════════════════════════════

export const isJsxUrl = (u) => /\.(jsx|tsx)(\?|#|$)/i.test(u || '');
export const isPdfUrl = (u) => /\.pdf(\?|#|$)/i.test(u || '');

/**
 * Wrap a plain React component source (no bundler) so it runs in the
 * sandboxed iframe: imports/exports are stripped, then React, ReactDOM and
 * Babel Standalone are loaded from a CDN and the source compiled in-browser
 * with both the react and typescript presets (so .tsx type syntax is removed
 * rather than failing silently with a blank page).
 */
export function wrapJsx(source) {
  let code = source
    .split('\n')
    .filter(line => !/^\s*import\s/.test(line))
    .join('\n');

  // Capture the default export's name, e.g. "export default function Foo"
  // or "export default Foo". Anonymous default exports have no identifier
  // to capture and get assigned one below.
  const namedDefault = code.match(/export\s+default\s+(?:function|class)?\s*([A-Za-z_$][\w$]*)/);
  let rootName = namedDefault ? namedDefault[1] : null;

  code = code
    .replace(/export\s+default\s+/g, rootName ? '' : 'const __DefaultComponent = ')
    .replace(/^\s*export\s+/gm, '');

  if (!rootName) rootName = '__DefaultComponent';

  const escapedCode = code.replace(/<\/script/gi, '<\\/script');

  return [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<style>html,body,#root{min-height:100%;margin:0;font-family:sans-serif;}',
    '.jsx-error{padding:2rem;color:#dc2626;font-family:monospace;white-space:pre-wrap;font-size:.85rem;}',
    '.jsx-loading{padding:2rem;color:#888;font-family:sans-serif;}</style>',
    '</head><body><div id="root"><div class="jsx-loading">Loading component…</div></div>',
    '<script type="text/plain" id="__src">',
    escapedCode,
    '<\/script>',
    '<script>',
    'function __showErr(msg) {',
    '  var el = document.getElementById("root");',
    '  if (el) el.innerHTML = "<div class=\\"jsx-error\\">" + String(msg).replace(/&/g,"&amp;").replace(/</g,"&lt;") + "</div>";',
    '}',
    'window.onerror = function(msg, src, line, col, err) { __showErr(err && err.message ? err.message : msg); };',
    'window.addEventListener("unhandledrejection", function(e) { __showErr(e.reason && e.reason.message ? e.reason.message : e.reason); });',
    'function __loadScript(src) {',
    '  return new Promise(function(resolve, reject) {',
    '    var s = document.createElement("script");',
    '    s.src = src;',
    '    s.onload = resolve;',
    '    s.onerror = function() { reject(new Error("Failed to load " + src + " — check your network/ad-blocker.")); };',
    '    document.head.appendChild(s);',
    '  });',
    '}',
    'Promise.all([',
    '  __loadScript("https://unpkg.com/react@18/umd/react.production.min.js"),',
    '  __loadScript("https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"),',
    '  __loadScript("https://unpkg.com/@babel/standalone@7/babel.min.js")',
    ']).then(function() {',
    '  try {',
    '    var __source = document.getElementById("__src").textContent;',
    '    var __compiled = Babel.transform(__source, {',
    '      presets: [["react"], ["typescript", { isTSX: true, allExtensions: true }]],',
    '      filename: "material.tsx"',
    '    }).code;',
    '    var __hooksPrelude = "var {useState,useEffect,useRef,useMemo,useCallback,useContext,useReducer,useLayoutEffect,Fragment,Component,createElement,memo,forwardRef} = React;";',
    `    var __fn = new Function("React", "ReactDOM", __hooksPrelude + __compiled + ';return (typeof ${rootName} !== "undefined" ? ${rootName} : (typeof App !== "undefined" ? App : null));');`,
    '    var __Root = __fn(React, ReactDOM);',
    '    if (__Root) { document.getElementById("root").innerHTML = ""; ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(__Root)); }',
    '    else { __showErr("No exported component found. Use a default export, or define a component called App."); }',
    '  } catch (err) {',
    '    console.error(err);',
    '    __showErr(err && err.message ? err.message : String(err));',
    '  }',
    '}).catch(function(err) { console.error(err); __showErr(err.message || String(err)); });',
    '<\/script>',
    '</body></html>'
  ].join('\n');
}

/**
 * Build the sandboxed PDF viewer. pdf.js renders pages onto canvases — no
 * text layer and no browser PDF toolbar — so there is no built-in save,
 * print or select affordance.
 *
 *   { dataB64 }  PDF stored in Firestore
 *   { urls: [] } remote PDF; the iframe fetches it itself, trying each URL
 *                in order, so large files never have to fit in Firestore.
 */
export function wrapPdf(opts) {
  const cfg = JSON.stringify(opts).replace(/</g, '\\u003c');
  return [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<style>',
    'html,body{margin:0;min-height:100%;background:#3b3d44;font-family:sans-serif;}',
    '#status{padding:2.5rem 1.5rem;color:#c7c9d1;text-align:center;font-size:.9rem;line-height:1.6;}',
    '#status.pdf-error{color:#fca5a5;white-space:pre-wrap;word-break:break-word;}',
    '.page{position:relative;margin:10px auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.4);}',
    '.page canvas{position:absolute;top:0;left:0;width:100%;height:100%;display:block;}',
    '#hud{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);display:none;align-items:center;gap:2px;background:rgba(20,21,32,.9);border-radius:99px;padding:4px 6px;color:#e5e7f0;font-size:.8rem;box-shadow:0 4px 14px rgba(0,0,0,.35);user-select:none;-webkit-user-select:none;z-index:10;}',
    '#hud button{background:none;border:none;color:#e5e7f0;font-size:1.05rem;width:30px;height:30px;border-radius:50%;cursor:pointer;line-height:1;padding:0;}',
    '#hud button:hover{background:rgba(255,255,255,.12);}',
    '#zoom-label{min-width:42px;text-align:center;}',
    '#page-label{border-left:1px solid rgba(255,255,255,.25);margin-left:4px;padding:0 9px;white-space:nowrap;}',
    '</style></head><body>',
    '<div id="status">Loading PDF…</div>',
    '<div id="pages"></div>',
    '<div id="hud">',
    '<button id="zoom-out" aria-label="Zoom out">−</button>',
    '<span id="zoom-label">100%</span>',
    '<button id="zoom-in" aria-label="Zoom in">+</button>',
    '<span id="page-label">– / –</span>',
    '</div>',
    '<script>var __PDF_CFG = ' + cfg + ';<\/script>',
    // No crossorigin="anonymous" here on purpose: it would make the whole
    // viewer fail if the CDN response ever lacks CORS headers (a proxy that
    // strips them, a mirror, self-hosting), and buys nothing since errors are
    // surfaced by the pdfjsLib check below rather than window.onerror.
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script>',
    '<script>',
    '(function () {',
    '  var statusEl = document.getElementById("status");',
    '  var pagesEl  = document.getElementById("pages");',
    '  function showErr(msg) {',
    '    document.getElementById("hud").style.display = "none";',
    '    statusEl.style.display = "block";',
    '    statusEl.classList.add("pdf-error");',
    '    statusEl.textContent = "Failed to load PDF\\n\\n" + msg;',
    '  }',
    '  if (!window.pdfjsLib) { showErr("The PDF engine could not be loaded — check your network/ad-blocker."); return; }',
    '  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";',
    '',
    '  var ZOOMS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];',
    '  var zoomIdx = 3, pdf = null, holders = [], defaultRatio = Math.SQRT2;',
    '  // renderSeq invalidates in-flight renders on zoom/resize; queue keeps',
    '  // page renders sequential so memory stays sane on long documents.',
    '  var renderSeq = 0, queue = Promise.resolve();',
    '',
    '  function b64ToBytes(b64) {',
    '    var bin = atob(b64), out = new Uint8Array(bin.length);',
    '    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);',
    '    return out;',
    '  }',
    '  function openDoc() {',
    '    if (__PDF_CFG.dataB64) return pdfjsLib.getDocument({ data: b64ToBytes(__PDF_CFG.dataB64) }).promise;',
    '    var urls = __PDF_CFG.urls || [], i = 0, errs = [];',
    '    function next() {',
    '      if (i >= urls.length) return Promise.reject(new Error(errs.join("\\n") || "No PDF source configured."));',
    '      var u = urls[i++];',
    '      var init = u.indexOf("api.github.com") > -1 ? { headers: { Accept: "application/vnd.github.v3.raw" } } : undefined;',
    '      return fetch(u, init).then(function (r) {',
    '        if (!r.ok) throw new Error("HTTP " + r.status);',
    '        return r.arrayBuffer();',
    '      }).then(function (buf) {',
    '        return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;',
    '      }).catch(function (e) { errs.push(e && e.message ? e.message : String(e)); return next(); });',
    '    }',
    '    return next();',
    '  }',
    '',
    '  function cssWidth() { return Math.round(Math.min(document.documentElement.clientWidth - 20, 860) * ZOOMS[zoomIdx]); }',
    '  function layout() {',
    '    var w = cssWidth();',
    '    holders.forEach(function (h) {',
    '      var ratio = parseFloat(h.dataset.ratio) || defaultRatio;',
    '      h.style.width = w + "px";',
    '      h.style.height = Math.round(w * ratio) + "px";',
    '    });',
    '  }',
    '',
    '  function renderPage(h) {',
    '    var seq = renderSeq, num = parseInt(h.dataset.page, 10);',
    '    h.dataset.queued = seq;',
    '    queue = queue.then(function () {',
    '      if (seq !== renderSeq) return;',
    '      return pdf.getPage(num).then(function (page) {',
    '        if (seq !== renderSeq) return;',
    '        var vp1 = page.getViewport({ scale: 1 });',
    '        h.dataset.ratio = vp1.height / vp1.width;',
    '        var w = cssWidth(), hpx = Math.round(w * (vp1.height / vp1.width));',
    '        h.style.width = w + "px";',
    '        h.style.height = hpx + "px";',
    '        // cap canvas pixels (~12M) — iOS Safari silently drops huge canvases',
    '        var px = Math.min(Math.min(window.devicePixelRatio || 1, 2), Math.sqrt(12e6 / (w * hpx)));',
    '        var canvas = document.createElement("canvas");',
    '        canvas.width = Math.max(1, Math.floor(w * px));',
    '        canvas.height = Math.max(1, Math.floor(hpx * px));',
    '        var vp = page.getViewport({ scale: canvas.width / vp1.width });',
    '        return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise.then(function () {',
    '          if (seq !== renderSeq) return;',
    '          h.innerHTML = "";',
    '          h.appendChild(canvas);',
    '          h.dataset.done = seq;',
    '        });',
    '      });',
    '    }).catch(function (e) { console.error("Page " + num, e); });',
    '  }',
    '',
    '  function renderInView() {',
    '    var vh = window.innerHeight, margin = vh * 1.5;',
    '    holders.forEach(function (h) {',
    '      var r = h.getBoundingClientRect();',
    '      if (r.bottom < -margin || r.top > vh + margin) return;',
    '      if (h.dataset.done == renderSeq || h.dataset.queued == renderSeq) return;',
    '      renderPage(h);',
    '    });',
    '    updatePageLabel();',
    '  }',
    '  function updatePageLabel() {',
    '    if (!holders.length) return;',
    '    var mid = window.innerHeight / 2, current = 1;',
    '    for (var i = 0; i < holders.length; i++) {',
    '      if (holders[i].getBoundingClientRect().top > mid) break;',
    '      current = i + 1;',
    '    }',
    '    document.getElementById("page-label").textContent = current + " / " + holders.length;',
    '  }',
    '',
    '  function setZoom(idx) {',
    '    idx = Math.max(0, Math.min(ZOOMS.length - 1, idx));',
    '    if (idx === zoomIdx) return;',
    '    var se = document.scrollingElement || document.documentElement;',
    '    var frac = se.scrollHeight > 0 ? se.scrollTop / se.scrollHeight : 0;',
    '    zoomIdx = idx;',
    '    // old canvases stay visible (CSS-scaled) until sharp replacements land',
    '    renderSeq++;',
    '    document.getElementById("zoom-label").textContent = Math.round(ZOOMS[zoomIdx] * 100) + "%";',
    '    layout();',
    '    se.scrollTop = frac * se.scrollHeight;',
    '    renderInView();',
    '  }',
    '',
    '  openDoc().then(function (doc) {',
    '    pdf = doc;',
    '    return pdf.getPage(1);',
    '  }).then(function (p1) {',
    '    var vp = p1.getViewport({ scale: 1 });',
    '    defaultRatio = vp.height / vp.width;',
    '    for (var i = 1; i <= pdf.numPages; i++) {',
    '      var h = document.createElement("div");',
    '      h.className = "page";',
    '      h.dataset.page = i;',
    '      pagesEl.appendChild(h);',
    '      holders.push(h);',
    '    }',
    '    statusEl.style.display = "none";',
    '    document.getElementById("hud").style.display = "flex";',
    '    layout();',
    '    renderInView();',
    '  }).catch(function (e) {',
    '    showErr(e && e.name === "PasswordException" ? "This PDF is password-protected. Remove the password and upload it again." : (e && e.message ? e.message : String(e)));',
    '  });',
    '',
    '  var ticking = false;',
    '  window.addEventListener("scroll", function () {',
    '    if (ticking) return;',
    '    ticking = true;',
    '    requestAnimationFrame(function () { ticking = false; renderInView(); });',
    '  }, { passive: true });',
    '  var resizeTimer = null;',
    '  window.addEventListener("resize", function () {',
    '    clearTimeout(resizeTimer);',
    '    resizeTimer = setTimeout(function () { renderSeq++; layout(); renderInView(); }, 200);',
    '  });',
    '  document.getElementById("zoom-in").addEventListener("click", function () { setZoom(zoomIdx + 1); });',
    '  document.getElementById("zoom-out").addEventListener("click", function () { setZoom(zoomIdx - 1); });',
    '})();',
    '<\/script>',
    '</body></html>'
  ].join('\n');
}

/**
 * Navigation guard injected into every material.
 *
 * A srcdoc iframe has no base URL of its own, so "#section" resolves
 * against the PARENT page and the iframe navigates to a nested copy
 * of the viewer — the material disappears. Serving the material from
 * a blob: URL gives it a real base so in-page anchors work natively;
 * this script handles everything a blob URL can't:
 *
 *   external links   open in a new tab instead of replacing the material
 *   material links   ask the host page to open that material as its own page
 *   dead relatives   explain themselves instead of blanking the frame
 */
const NAV_GUARD = `
<script>
(function () {
  function post(type, payload) {
    try { parent.postMessage(Object.assign({ __ck: true, type: type }, payload), '*'); }
    catch (e) {}
  }
  function notice(text) {
    var n = document.createElement('div');
    n.textContent = text;
    n.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);' +
      'background:#161726;color:#fff;padding:10px 16px;border-radius:10px;font:14px sans-serif;' +
      'z-index:2147483647;max-width:86%;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.3)';
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 3200);
  }
  // "material:<id>", data-material, or any viewer.html?id= link is a
  // jump to another material.
  //
  // The href is matched as text rather than with new URL(href, base):
  // this document is served from a blob: URL, whose path is opaque, so
  // resolving a relative URL against it throws.
  function materialId(href, a) {
    var m = /^material:(.+)$/i.exec(href);
    if (m) return decodeURIComponent(m[1].trim());
    if (a && a.dataset && a.dataset.material) return a.dataset.material;
    var v = /(?:^|\\/)viewer\\.html\\?(?:[^#]*&)?id=([^&#]+)/i.exec(href);
    if (v) { try { return decodeURIComponent(v[1]); } catch (e) { return v[1]; } }
    return null;
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var raw = a.getAttribute('href') || '';
    if (!raw || raw.charAt(0) === '#') return;        // blob URL handles anchors
    if (/^(mailto:|tel:)/i.test(raw)) return;

    var id = materialId(raw, a);
    if (id) { e.preventDefault(); post('open-material', { id: id }); return; }

    if (/^https?:/i.test(raw)) {                       // real external link
      e.preventDefault();
      window.open(raw, '_blank', 'noopener');
      return;
    }
    // A relative path to a file that was never uploaded. Navigating
    // would blank the frame, so say what happened instead.
    e.preventDefault();
    notice('That link points to "' + raw + '", which isn\\'t part of this material.');
  }, true);

  // Anything that still tries to replace the whole frame gets stopped.
  window.addEventListener('beforeunload', function (e) { post('nav-attempt', {}); });
}());
</script>`;

/** Insert the guard just before </body> so it runs after the content. */
export function withNavGuard(html) {
  if (typeof html !== 'string' || !html) return html;
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? html + NAV_GUARD : html.slice(0, i) + NAV_GUARD + html.slice(i);
}

/** Turn a raw.githubusercontent.com URL into CORS-friendly fetch candidates. */
export function githubFetchUrls(rawUrl) {
  const m = String(rawUrl).match(
    /https:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/
  );
  if (!m) return [rawUrl];
  const [, user, repo, branch, path] = m;
  return [
    `https://api.github.com/repos/${user}/${repo}/contents/${path}?ref=${branch}`,
    `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`
  ];
}
