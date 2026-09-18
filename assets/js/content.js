// ═══════════════════════════════════════════════════════════
//  Material loading.
//
//  Storage is split in two so paid content can be gated
//  server-side (see firestore.rules):
//
//    materials/{id}        metadata — title, tag, folder, price.
//                          Readable by any signed-in user so the
//                          catalogue can be browsed.
//    materialContent/{id}  the bytes — html/jsx/pdf/url. Readable
//                          only if {id} is in the caller's files[].
//
//  Until the one-click migration in the admin panel has run, older
//  documents still carry their content inline on materials/{id};
//  readContent() falls back to that so nothing breaks mid-rollout.
// ═══════════════════════════════════════════════════════════
import { db, doc, getDoc, collection, getDocs } from './firebase.js';
import { wrapJsx, wrapPdf, isJsxUrl, isPdfUrl, githubFetchUrls } from './render.js';

export const CONTENT_FIELDS = ['htmlContent', 'jsxContent', 'pdfContent', 'url'];

/** True if a material doc still has content stored inline (pre-migration). */
export const hasInlineContent = (m) =>
  CONTENT_FIELDS.some(f => m && m[f]);

/** Lightweight shape used by listings — never carries content. */
export function toMeta(id, m) {
  return {
    id,
    title: m.title || '(untitled)',
    tag: m.tag || '',
    folderId: m.folderId || null,
    createdAt: m.createdAt || null,
    pricePaise: Number.isFinite(m.pricePaise) ? m.pricePaise : null,
    published: m.published !== false,
    hasSample: m.hasSample === true,
    kind: m.kind || inferKind(m)
  };
}

/** Best-effort content type, for icons and badges. */
export function inferKind(m) {
  if (m.pdfContent || isPdfUrl(m.url)) return 'pdf';
  if (m.jsxContent || isJsxUrl(m.url)) return 'jsx';
  if (m.htmlContent) return 'html';
  if (m.url) return 'url';
  return 'unknown';
}

export function kindIcon(kind, id = '') {
  if (kind === 'pdf') return '📕';
  if (kind === 'jsx') return '⚛️';
  const icons = ['📘', '📗', '📙', '📓', '📔', '📒', '🗒️'];
  return icons[Math.abs(String(id).charCodeAt(0) || 0) % icons.length];
}

/** All material metadata (content stripped). */
export async function listMaterials() {
  const snap = await getDocs(collection(db, 'materials'));
  return snap.docs.map(d => toMeta(d.id, d.data()));
}

export async function listFolders() {
  const snap = await getDocs(collection(db, 'folders'));
  const map = {};
  snap.forEach(d => { map[d.id] = d.data(); });
  return map;
}

/**
 * Fetch the renderable content for one material.
 * Throws a friendly Error when the read is denied or missing.
 */
export async function readContent(id) {
  let data = null;

  try {
    const snap = await getDoc(doc(db, 'materialContent', id));
    if (snap.exists()) data = snap.data();
  } catch (e) {
    // permission-denied here means "not purchased / not assigned"
    if (e?.code === 'permission-denied') {
      throw new Error('You do not have access to this material.');
    }
    throw e;
  }

  if (!data) {
    // Pre-migration fallback: content still inline on the material doc.
    const legacy = await getDoc(doc(db, 'materials', id));
    if (!legacy.exists()) throw new Error('Material not found.');
    const m = legacy.data();
    if (!hasInlineContent(m)) {
      throw new Error('No content stored for this material yet.');
    }
    data = m;
  }

  return data;
}

/**
 * Free preview for a material.
 *
 * Samples live in their own collection and are readable by anyone
 * signed in — that is the point of a sample. The material's metadata
 * carries hasSample so the store can show the right button without
 * pulling every sample document just to find out.
 */
export async function readSample(id) {
  const snap = await getDoc(doc(db, 'materialSample', id));
  if (!snap.exists()) throw new Error('No sample has been added for this material yet.');
  return snap.data();
}

/**
 * Build the document handed to the sandboxed iframe.
 * Returns { srcdoc } — always a full HTML string.
 */
export function buildViewerDoc(data) {
  if (data.htmlContent) return data.htmlContent;
  if (data.jsxContent)  return wrapJsx(data.jsxContent);
  if (data.pdfContent)  return wrapPdf({ dataB64: data.pdfContent });

  if (data.url) {
    if (isPdfUrl(data.url)) return wrapPdf({ urls: githubFetchUrls(data.url) });
    return null; // needs an async fetch — handled by fetchRemoteDoc()
  }
  throw new Error('No content stored for this material yet.');
}

/** Remote HTML/JSX has to be fetched by the host page (CORS-friendly URLs). */
export async function fetchRemoteDoc(url) {
  const candidates = githubFetchUrls(url);
  const errors = [];

  for (const u of candidates) {
    try {
      const init = u.includes('api.github.com')
        ? { headers: { Accept: 'application/vnd.github.v3.raw' } }
        : undefined;
      const resp = await fetch(u, init);
      if (!resp.ok) { errors.push(`HTTP ${resp.status}`); continue; }
      const text = await resp.text();
      return isJsxUrl(url) ? wrapJsx(text) : text;
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  throw new Error(
    'Could not fetch the file. Make sure the repository is public and the URL is correct. ' +
    (errors.length ? `(${errors.join('; ')})` : '')
  );
}
