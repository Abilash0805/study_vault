// ═══════════════════════════════════════════════════════════
//  The plan cards, in one place.
//
//  They appear on the plans page, in the store, and in the
//  store's popup. Three copies of the same pricing would drift,
//  and the one thing that must never be wrong twice is a price.
// ═══════════════════════════════════════════════════════════
import { el, fmtMoney, toast } from './ui.js';
import { PLAN_LIST, perDayPaise, isSubActive } from './subscriptions.js';
import { createSubscriptionOrder } from './orders.js';

/** The plan with the lowest per-day cost — computed, never hardcoded. */
export const bestValue = () => {
  const cheapest = Math.min(...PLAN_LIST.map(perDayPaise));
  return PLAN_LIST.find(p => perDayPaise(p) === cheapest);
};

export function planCard(plan, { best = false, student = null, payable = true,
                                 email, compact = false } = {}) {
  const renewing = isSubActive(student);

  const label = renewing ? `Add ${plan.days} more days`
                         : `Choose ${plan.label.toLowerCase()}`;
  const buy = el('button', { class: 'btn btn-primary btn-block' }, label);

  buy.addEventListener('click', async () => {
    buy.disabled = true;
    buy.textContent = 'Creating order…';
    try {
      const order = await createSubscriptionOrder({ email, planId: plan.id });
      location.href = `checkout.html?order=${order.id}`;
    } catch (e) {
      buy.disabled = false;
      buy.textContent = label;
      toast(e.message || 'Could not start that order', 'err');
    }
  });

  return el('div', { class: 'plan-card' + (best ? ' is-best' : '') + (compact ? ' is-compact' : '') },
    best ? el('span', { class: 'plan-flag' }, 'Better value') : null,
    el('h2', {}, plan.label),
    el('div', { class: 'plan-price' },
      fmtMoney(plan.pricePaise),
      el('span', { class: 'plan-per' }, `/ ${plan.days} days`)),
    el('p', { class: 'plan-rate' }, `about ${fmtMoney(perDayPaise(plan))} a day`),
    compact ? null : el('p', { class: 'plan-blurb' }, plan.blurb),
    payable ? buy
            : el('p', { class: 'muted small' }, 'UPI payment has not been set up yet.')
  );
}

/** Every plan, as a grid. */
export function planGrid(opts = {}) {
  const best = bestValue();
  return el('div', { class: 'plan-grid' + (opts.compact ? ' is-compact' : '') },
    ...PLAN_LIST.map(p => planCard(p, { ...opts, best: p.id === best.id })));
}
