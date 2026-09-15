// ═══════════════════════════════════════════════════════════
//  Session / access control (client side).
//
//  IMPORTANT: everything here is convenience and UX only. The
//  real enforcement lives in firestore.rules — a user who edits
//  this file in devtools still cannot read content they have
//  not been granted, because the server checks on every read.
// ═══════════════════════════════════════════════════════════
import {
  auth, db, doc, getDoc,
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from './firebase.js';
import { ADMIN_EMAIL } from './config.js';
import { toast } from './ui.js';

export const isAdminEmail = (email) =>
  !!email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

/** Resolve the current user exactly once (auth state settles async). */
export function currentUser() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, u => { stop(); resolve(u || null); });
  });
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export async function doSignOut(redirectTo = 'index.html') {
  try { await signOut(auth); } catch (_) {}
  location.href = redirectTo;
}

/** The signed-in student's own doc (their files[] grant list). */
export async function loadStudent(email) {
  try {
    const snap = await getDoc(doc(db, 'students', email.toLowerCase()));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (e) {
    console.error('loadStudent:', e);
    return null;
  }
}

/**
 * Page guard. Resolves to { user, isAdmin, student } or redirects.
 *
 *   adminOnly  — bounce non-admins to the library
 *   allowAnon  — resolve with user:null instead of redirecting
 */
export async function requireAuth({ adminOnly = false, allowAnon = false } = {}) {
  const user = await currentUser();

  if (!user) {
    if (allowAnon) return { user: null, isAdmin: false, student: null };
    const back = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    location.replace('index.html?next=' + back);
    return new Promise(() => {}); // never resolves; navigation is in flight
  }

  const isAdmin = isAdminEmail(user.email);

  if (adminOnly && !isAdmin) {
    toast('Admin access only', 'err');
    location.replace('library.html');
    return new Promise(() => {});
  }

  const student = isAdmin ? null : await loadStudent(user.email);
  return { user, isAdmin, student };
}

/** Material IDs this user may open. Admins get null (= everything). */
export function grantedIds(isAdmin, student) {
  if (isAdmin) return null;
  return new Set(student?.files || []);
}
