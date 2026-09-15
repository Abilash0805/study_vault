// ═══════════════════════════════════════════════════════════
//  Orders, payments and the ledger.
//
//  There is no payment gateway. UPI cannot call back into a
//  static site, so a payment is confirmed when the admin
//  matches it in their UPI app and approves the order.
//
//  Everything funnels through confirmPayment() below. That is
//  the seam a real gateway would plug into later: a webhook
//  handler would call the same function with method:'gateway'
//  and the rest of the system would not change.
// ═══════════════════════════════════════════════════════════
import {
  db, doc, getDoc, setDoc, addDoc, updateDoc,
  collection, getDocs, query, where, arrayUnion
} from './firebase.js';

/* ── status lifecycle ─────────────────────────────────────
   pending_payment ──submitUtr──> awaiting_confirmation
         │                               │
         │                        approve │ reject
      cancel/expire                       ▼
         ▼                          paid ──refund──> refunded
      cancelled / expired           rejected
   ─────────────────────────────────────────────────────── */
export const STATUS = {
  PENDING:   'pending_payment',
  AWAITING:  'awaiting_confirmation',
  PAID:      'paid',
  REJECTED:  'rejected',
  CANCELLED: 'cancelled',
  EXPIRED:   'expired',
  REFUNDED:  'refunded'
};

export const STATUS_META = {
  [STATUS.PENDING]:   { label: 'Awaiting payment',     badge: 'badge-amber' },
  [STATUS.AWAITING]:  { label: 'Checking payment',     badge: 'badge-blue'  },
  [STATUS.PAID]:      { label: 'Paid',                 badge: 'badge-green' },
  [STATUS.REJECTED]:  { label: 'Payment not found',    badge: 'badge-red'   },
  [STATUS.CANCELLED]: { label: 'Cancelled',            badge: 'badge-grey'  },
  [STATUS.EXPIRED]:   { label: 'Expired',              badge: 'badge-grey'  },
  [STATUS.REFUNDED]:  { label: 'Refunded',             badge: 'badge-violet'}
};

/** Orders left unpaid this long are treated as abandoned. */
export const ORDER_TTL_MS = 24 * 60 * 60 * 1000;

/* ── ids ──────────────────────────────────────────────── */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

function randomCode(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
}

/** Human-readable order number, e.g. SV-260915-K7Q2. */
export function newOrderNo(now = new Date()) {
  const y = String(now.getFullYear()).slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `SV-${y}${m}${d}-${randomCode(4)}`;
}

/**
 * Reference embedded in the UPI request as `tr`, so the payment
 * identifies the order it belongs to. UPI only reliably accepts
 * alphanumerics here, so the order number's dashes are stripped.
 */
export function newTxnRef(orderNo) {
  return orderNo.replace(/-/g, '') + randomCode(3);
}

/* ── UPI ──────────────────────────────────────────────── */

/** Rupees, always 2dp — UPI apps reject odd amount formats. */
export const paiseToAmount = (paise) => (Number(paise || 0) / 100).toFixed(2);

/**
 * Build the upi:// request. Tapping it on a phone opens the UPI
 * app with payee, amount and reference already filled in, which
 * removes the two biggest sources of reconciliation pain:
 * mistyped amounts and payments with no reference.
 */
export function buildUpiUri({ vpa, payeeName, amountPaise, txnRef, note }) {
  if (!vpa) throw new Error('No UPI ID configured.');
  const q = new URLSearchParams();
  q.set('pa', vpa);
  if (payeeName) q.set('pn', payeeName);
  q.set('am', paiseToAmount(amountPaise));
  q.set('cu', 'INR');
  if (txnRef) q.set('tr', txnRef);
  q.set('tn', (note || 'StudyVault').replace(/[^A-Za-z0-9 .-]/g, '').slice(0, 40));
  // URLSearchParams uses '+' for spaces; UPI apps want %20.
  return 'upi://pay?' + q.toString().replace(/\+/g, '%20');
}

/** A UPI reference (RRN/UTR) is 12 digits. Some banks show more. */
export function normaliseUtr(raw) {
  return String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
}
export function isPlausibleUtr(raw) {
  const u = normaliseUtr(raw);
  return /^[A-Z0-9]{8,24}$/.test(u);
}

/* ── settings ─────────────────────────────────────────── */

export async function loadPaymentSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'payment'));
    return snap.exists() ? snap.data() : null;
  } catch (_) {
    return null;
  }
}

export async function savePaymentSettings(data) {
  await setDoc(doc(db, 'settings', 'payment'),
    { ...data, updatedAt: Date.now() }, { merge: true });
}

/* ── creating an order ────────────────────────────────── */

/**
 * Create an order from cart ids. Prices are taken from `byId`
 * (freshly read from Firestore), never from the client cart, and
 * the item titles/prices are snapshotted so later price changes
 * don't rewrite history.
 */
export async function createOrder({ email, ids, byId, ownedIds }) {
  const items = [];
  for (const id of ids) {
    const m = byId[id];
    if (!m) continue;
    if (ownedIds?.has(id)) continue;             // already owned
    if (!m.published || m.pricePaise === null) continue; // not for sale
    items.push({ id, title: m.title, pricePaise: m.pricePaise || 0 });
  }
  if (!items.length) throw new Error('Nothing in this order is available to buy.');

  const orderNo = newOrderNo();
  const order = {
    orderNo,
    txnRef: newTxnRef(orderNo),
    email: email.toLowerCase(),
    items,
    totalPaise: items.reduce((s, i) => s + i.pricePaise, 0),
    status: STATUS.PENDING,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const ref = await addDoc(collection(db, 'orders'), order);
  return { id: ref.id, ...order };
}

/**
 * Student says "I've paid".
 *
 * The reference is optional on purpose: the QR already carries the
 * order number in the payment note, so most payments arrive
 * self-identifying and asking a student to find a UTR is friction
 * for little gain. When they do supply one it is kept, because it
 * makes reconciliation exact and powers the duplicate-payment check.
 */
export async function markAsPaid(orderId, utr) {
  const clean = normaliseUtr(utr);
  if (clean && !isPlausibleUtr(clean)) {
    throw new Error('That does not look like a valid UPI reference number. Leave it blank if you are not sure.');
  }
  await updateDoc(doc(db, 'orders', orderId), {
    ...(clean ? { utr: clean } : {}),
    status: STATUS.AWAITING,
    submittedAt: Date.now(),
    updatedAt: Date.now()
  });
}

export async function cancelOrder(orderId) {
  await updateDoc(doc(db, 'orders', orderId), {
    status: STATUS.CANCELLED,
    updatedAt: Date.now()
  });
}

/* ── reading ──────────────────────────────────────────── */

/**
 * The where() filter is not a nicety: rules cannot filter a
 * collection query, so an unfiltered read of /orders is rejected
 * outright for a student. Constraining the query to their own
 * email is what makes it provably safe, and therefore allowed.
 */
export async function listMyOrders(email) {
  const snap = await getDocs(query(
    collection(db, 'orders'),
    where('email', '==', email.toLowerCase())
  ));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function listAllOrders() {
  const snap = await getDocs(collection(db, 'orders'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function listLedger() {
  const snap = await getDocs(collection(db, 'ledger'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.at - a.at);
}

export const isExpired = (o) =>
  o.status === STATUS.PENDING && (Date.now() - o.createdAt) > ORDER_TTL_MS;

/* ── fraud / sanity checks ────────────────────────────── */

/**
 * Checks the admin should see before approving. None of these
 * block approval on their own — they surface things that are
 * worth a second look.
 */
export function auditOrder(order, allOrders, materialsById) {
  const flags = [];

  // A UPI reference can only pay for one order.
  if (order.utr) {
    const clash = allOrders.find(o =>
      o.id !== order.id && o.utr === order.utr &&
      [STATUS.PAID, STATUS.AWAITING].includes(o.status));
    if (clash) {
      flags.push({ level: 'danger',
        text: `This reference was already submitted on order ${clash.orderNo}.` });
    }
  } else {
    // With no reference, two orders for the same amount are genuinely
    // hard to tell apart in a UPI app. Match on the order number that
    // the QR put in the payment note.
    const sameAmount = allOrders.filter(o =>
      o.id !== order.id &&
      o.status === STATUS.AWAITING &&
      o.totalPaise === order.totalPaise);
    if (sameAmount.length) {
      flags.push({ level: 'warn',
        text: `${sameAmount.length} other order(s) for the same amount are also awaiting confirmation ` +
              `(${sameAmount.map(o => o.orderNo).join(', ')}). Match on the order number in the payment note.` });
    }
  }

  // The stored total must still match current prices.
  const live = order.items.reduce((s, i) => {
    const m = materialsById[i.id];
    return s + (m && Number.isFinite(m.pricePaise) ? m.pricePaise : i.pricePaise);
  }, 0);
  if (live !== order.totalPaise) {
    flags.push({ level: 'warn',
      text: `Order total (${(order.totalPaise/100).toFixed(2)}) differs from current prices (${(live/100).toFixed(2)}).` });
  }

  const sum = order.items.reduce((s, i) => s + (i.pricePaise || 0), 0);
  if (sum !== order.totalPaise) {
    flags.push({ level: 'danger',
      text: `Total does not match its own line items (${(sum/100).toFixed(2)}).` });
  }

  if (isExpired(order)) {
    flags.push({ level: 'warn', text: 'This order is more than 24 hours old.' });
  }

  return flags;
}

/* ── confirming payment ───────────────────────────────── */

/**
 * THE seam. Manual approval calls this with method:'manual'.
 * A future gateway webhook calls it with method:'gateway' and
 * its own reference — nothing else in the system changes.
 *
 * Grants access, then records the ledger entry. Both are needed;
 * if the ledger write fails the grant still stands, which is the
 * safe direction to fail (the student gets what they paid for).
 */
export async function confirmPayment(order, { method = 'manual', actor, reference } = {}) {
  const ids = order.items.map(i => i.id);

  await updateDoc(doc(db, 'students', order.email), {
    files: arrayUnion(...ids)
  });

  await updateDoc(doc(db, 'orders', order.id), {
    status: STATUS.PAID,
    paidAt: Date.now(),
    updatedAt: Date.now(),
    confirmedBy: actor || null,
    confirmationMethod: method,
    ...(reference ? { gatewayReference: reference } : {})
  });

  await writeLedger({
    orderId: order.id, orderNo: order.orderNo, email: order.email,
    type: 'charge', amountPaise: order.totalPaise,
    note: `Payment confirmed (${method})${order.utr ? ' · UTR ' + order.utr : ''}`,
    actor
  });
}

export async function rejectOrder(order, reason, actor) {
  await updateDoc(doc(db, 'orders', order.id), {
    status: STATUS.REJECTED,
    rejectedReason: reason || 'Payment could not be verified',
    rejectedAt: Date.now(),
    updatedAt: Date.now(),
    confirmedBy: actor || null
  });
  await writeLedger({
    orderId: order.id, orderNo: order.orderNo, email: order.email,
    type: 'rejected', amountPaise: 0,
    note: reason || 'Payment could not be verified', actor
  });
}

/**
 * Refund: records the reversal and removes the access the order
 * granted. Access is only revoked for items no OTHER paid order
 * also covers, so refunding one order can't strip a material the
 * student separately bought.
 */
export async function refundOrder(order, reason, actor, allOrders = []) {
  const stillPaidFor = new Set();
  for (const o of allOrders) {
    if (o.id === order.id) continue;
    if (o.status !== STATUS.PAID) continue;
    if (o.email !== order.email) continue;
    o.items.forEach(i => stillPaidFor.add(i.id));
  }

  const revoke = order.items.map(i => i.id).filter(id => !stillPaidFor.has(id));

  if (revoke.length) {
    const snap = await getDoc(doc(db, 'students', order.email));
    const current = snap.exists() ? (snap.data().files || []) : [];
    await updateDoc(doc(db, 'students', order.email), {
      files: current.filter(id => !revoke.includes(id))
    });
  }

  await updateDoc(doc(db, 'orders', order.id), {
    status: STATUS.REFUNDED,
    refundedAt: Date.now(),
    updatedAt: Date.now(),
    refundReason: reason || '',
    refundedBy: actor || null
  });

  await writeLedger({
    orderId: order.id, orderNo: order.orderNo, email: order.email,
    type: 'refund', amountPaise: -order.totalPaise,
    note: (reason || 'Refunded') + (revoke.length ? ` · revoked ${revoke.length} item(s)` : ''),
    actor
  });
}

export async function expireOrder(order, actor) {
  await updateDoc(doc(db, 'orders', order.id), {
    status: STATUS.EXPIRED, updatedAt: Date.now(), confirmedBy: actor || null
  });
}

/** The ledger is append-only: entries are never updated or deleted. */
async function writeLedger(entry) {
  try {
    await addDoc(collection(db, 'ledger'), { ...entry, at: Date.now() });
  } catch (e) {
    console.error('ledger write failed', e);
  }
}

/** Net of all ledger entries, in paise. */
export function ledgerTotal(entries) {
  return entries.reduce((s, e) => s + (e.amountPaise || 0), 0);
}
