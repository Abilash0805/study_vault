// ═══════════════════════════════════════════════════════════
//  Subscriptions.
//
//  A subscription is a *date*, not a list. `students/{email}`
//  carries `subUntil` — epoch milliseconds — and while that is in
//  the future the student may open every material, including ones
//  published after they paid. That is the whole point: a grant
//  list can only ever name things that already exist.
//
//  It sits alongside the per-material grants rather than
//  replacing them. `files[]` is permanent — something bought
//  outright stays bought — and the subscription is a second,
//  temporary route to the same content. When it lapses the
//  student keeps everything they bought individually.
//
//  Expiry is enforced in firestore.rules, not here. This module
//  is what the UI reads; a student who edits it in devtools still
//  cannot open anything, because every read is checked against
//  request.time on the server.
// ═══════════════════════════════════════════════════════════

export const DAY_MS = 24 * 60 * 60 * 1000;

export const PLANS = {
  weekly:  { id: 'weekly',  label: 'Weekly',  pricePaise: 6900,  days: 7,
             blurb: 'Everything on the site for a week.' },
  monthly: { id: 'monthly', label: 'Monthly', pricePaise: 19900, days: 30,
             blurb: 'Everything on the site for a month — the better deal.' }
};

/** In the order they should be shown. */
export const PLAN_LIST = [PLANS.weekly, PLANS.monthly];

export function planById(id) {
  return PLANS[String(id || '').toLowerCase()] || null;
}

/** Per-day cost, for an honest "works out cheaper" line. */
export function perDayPaise(plan) {
  return Math.round(plan.pricePaise / plan.days);
}

/* ── reading a student's subscription ─────────────────── */

export const subUntil = (student) => Number(student?.subUntil || 0);

export function isSubActive(student, now = Date.now()) {
  return subUntil(student) > now;
}

/** Whole days left, rounded up — 0 when there is no live subscription. */
export function subDaysLeft(student, now = Date.now()) {
  const ms = subUntil(student) - now;
  return ms > 0 ? Math.ceil(ms / DAY_MS) : 0;
}

/** True once it has run out, but only for someone who had one. */
export function subLapsed(student, now = Date.now()) {
  const until = subUntil(student);
  return until > 0 && until <= now;
}

/**
 * Where a new period should end.
 *
 * Renewing early adds to what is left rather than throwing it
 * away — buying a second month on day 20 should give you 40 days,
 * not reset you to 30. Starting from `now` when the subscription
 * has already lapsed stops an old date from swallowing the
 * purchase.
 */
export function nextExpiry(currentUntil, plan, now = Date.now()) {
  const base = Math.max(Number(currentUntil || 0), now);
  return base + plan.days * DAY_MS;
}

/**
 * Where it should end after a refund: the plan's days come back
 * off. If that leaves nothing in the future the subscription is
 * over; if other periods were stacked on top, those survive.
 */
export function expiryAfterRefund(currentUntil, plan, now = Date.now()) {
  const reduced = Number(currentUntil || 0) - plan.days * DAY_MS;
  return reduced > now ? reduced : 0;
}
