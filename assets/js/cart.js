// ═══════════════════════════════════════════════════════════
//  Shopping cart.
//
//  The cart lives in localStorage: it is per-device, ephemeral,
//  and costs nothing to update. Only the ORDER is durable, and
//  that is created in Firestore at checkout.
//
//  Nothing here is trusted. The cart stores ids and quantities
//  only — never prices. Prices are always re-read from Firestore
//  when the cart is shown and again when the order is created,
//  so a tampered cart cannot change what anything costs.
// ═══════════════════════════════════════════════════════════

const KEY = 'studyvault.cart.v1';

function safeRead() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch (_) {
    return []; // private mode, blocked storage, corrupt value
  }
}

function safeWrite(ids) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]));
  } catch (_) { /* storage unavailable — cart is best-effort */ }
  notify();
}

const listeners = new Set();
function notify() {
  const n = count();
  listeners.forEach(fn => { try { fn(n); } catch (_) {} });
}

/** Subscribe to cart size changes (also fires across tabs). */
export function onChange(fn) {
  listeners.add(fn);
  fn(count());
  return () => listeners.delete(fn);
}

window.addEventListener('storage', e => { if (e.key === KEY) notify(); });

export const items  = () => safeRead();
export const count  = () => safeRead().length;
export const has    = (id) => safeRead().includes(id);

export function add(id) {
  const ids = safeRead();
  if (!ids.includes(id)) ids.push(id);
  safeWrite(ids);
}

export function remove(id) {
  safeWrite(safeRead().filter(x => x !== id));
}

export function toggle(id) {
  has(id) ? remove(id) : add(id);
  return has(id);
}

export function clear() {
  safeWrite([]);
}

/**
 * Drop anything the student already owns or that is no longer for sale.
 * Returns the ids removed, so the UI can explain what happened.
 */
export function prune(validIds) {
  const before = safeRead();
  const keep = before.filter(id => validIds.has(id));
  if (keep.length !== before.length) safeWrite(keep);
  return before.filter(id => !validIds.has(id));
}

/** Total in paise from authoritative price data. */
export function total(materialsById, ids = items()) {
  return ids.reduce((sum, id) => sum + (materialsById[id]?.pricePaise || 0), 0);
}
