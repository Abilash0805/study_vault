// ═══════════════════════════════════════════════════════════
//  An in-memory stand-in for the Firebase modular SDK.
//
//  The pages import Firebase straight from gstatic, so the test
//  harness intercepts those requests and serves these modules
//  instead. The database is a plain object on `window.__MOCK_DB__`,
//  which tests read back to see what a page actually wrote.
//
//  It models the one rule shape that matters to the client: a
//  rules function may refuse a read, and the error carries
//  code 'permission-denied' exactly as Firestore's does.
// ═══════════════════════════════════════════════════════════

export const FIREBASE_APP = `
export function initializeApp(cfg) { return { options: cfg }; }
`;

export const FIREBASE_AUTH = `
export function getAuth() { return { currentUser: window.__MOCK_USER__ || null }; }
export function GoogleAuthProvider() { this.setCustomParameters = () => {}; }
export function signInWithPopup() { return Promise.resolve({ user: window.__MOCK_USER__ }); }
export function signOut() { window.__MOCK_USER__ = null; return Promise.resolve(); }
export function onAuthStateChanged(auth, cb) {
  Promise.resolve().then(() => cb(window.__MOCK_USER__ || null));
  return () => {};
}
`;

export const FIREBASE_FIRESTORE = `
const DB = () => (window.__MOCK_DB__ = window.__MOCK_DB__ || {});
const col = (name) => (DB()[name] = DB()[name] || {});

function denied(where) {
  const e = new Error('Missing or insufficient permissions. (' + where + ')');
  e.code = 'permission-denied';
  return e;
}
function allowed(collection, id, filtered) {
  const r = window.__MOCK_RULES__;
  return typeof r === 'function' ? r(collection, id, !!filtered) !== false : true;
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function getFirestore() { return { __mock: true }; }
export function doc(db, collection, id) { return { collection, id }; }
export function collection(db, name) { return { collection: name }; }

export function query(ref, ...constraints) {
  return { collection: ref.collection, constraints };
}
export function where(field, op, value) { return { field, op, value }; }

export function arrayUnion(...values) { return { __op: 'union', values }; }
export function arrayRemove(...values) { return { __op: 'remove', values }; }
export function deleteField() { return { __op: 'delete' }; }

function applyOps(target, data) {
  const out = { ...target };
  for (const [k, v] of Object.entries(data)) {
    if (v && v.__op === 'union') {
      const cur = Array.isArray(out[k]) ? out[k] : [];
      out[k] = [...new Set([...cur, ...v.values])];
    } else if (v && v.__op === 'remove') {
      const cur = Array.isArray(out[k]) ? out[k] : [];
      out[k] = cur.filter(x => !v.values.includes(x));
    } else if (v && v.__op === 'delete') {
      delete out[k];
    } else {
      out[k] = v;
    }
  }
  return out;
}

const snapOf = (id, data) => ({
  id, exists: () => data !== undefined, data: () => clone(data)
});

export async function getDoc(ref) {
  if (!allowed(ref.collection, ref.id, false)) throw denied(ref.collection + '/' + ref.id);
  return snapOf(ref.id, col(ref.collection)[ref.id]);
}

export async function getDocs(ref) {
  const name = ref.collection;
  const filtered = !!(ref.constraints && ref.constraints.length);
  if (!allowed(name, null, filtered)) throw denied(name);

  let rows = Object.entries(col(name)).map(([id, data]) => snapOf(id, data));
  for (const c of (ref.constraints || [])) {
    if (c.op === '==') rows = rows.filter(r => r.data()[c.field] === c.value);
  }
  return { docs: rows, size: rows.length, empty: !rows.length,
           forEach: (fn) => rows.forEach(fn) };
}

export async function setDoc(ref, data, opts) {
  const c = col(ref.collection);
  const base = (opts && opts.merge && c[ref.id]) ? c[ref.id] : {};
  c[ref.id] = applyOps(base, data);
  return undefined;
}

export async function addDoc(ref, data) {
  const id = 'gen-' + Math.random().toString(36).slice(2, 10);
  col(ref.collection)[id] = applyOps({}, data);
  return { id };
}

export async function updateDoc(ref, data) {
  const c = col(ref.collection);
  if (!c[ref.id]) { const e = new Error('No document to update'); e.code = 'not-found'; throw e; }
  c[ref.id] = applyOps(c[ref.id], data);
  return undefined;
}

export async function deleteDoc(ref) { delete col(ref.collection)[ref.id]; }

// firebase.js re-exports these, so the module must provide them even
// though nothing in the app calls them yet.
export function orderBy(field, dir) { return { field, dir }; }
export function limit(n) { return { n }; }
export function serverTimestamp() { return Date.now(); }
export function writeBatch() {
  const ops = [];
  return { set: (...a) => ops.push(a), update: (...a) => ops.push(a),
           delete: (...a) => ops.push(a), commit: async () => {} };
}
export async function runTransaction(db, fn) {
  return fn({ get: async () => ({ exists: () => false }) });
}
`;

