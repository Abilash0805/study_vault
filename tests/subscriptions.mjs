// Subscriptions: plans, buying one, what it opens, and what happens
// when it lapses or is refunded.
import { readFileSync } from 'fs';
import { launch, openPage, fixture, BASE, DAY, suite } from './harness.mjs';
const { check, report } = suite();
const browser = await launch();

const withSub = (d, msFromNow, plan = 'monthly') => {
  d.students['student@example.com'].subUntil = Date.now() + msFromNow;
  d.students['student@example.com'].subPlan = plan;
  return d;
};
const awaiting = (d, extra = {}) => {
  d.orders['o-sub'] = {
    orderNo: 'CK-260101-AAAA', txnRef: 'CK260101AAAAXYZ',
    email: 'student@example.com', kind: 'subscription', plan: 'monthly', planDays: 30,
    items: [{ id: 'plan:monthly', title: 'Monthly plan — all materials', pricePaise: 19900 }],
    totalPaise: 19900, status: 'awaiting_confirmation',
    createdAt: Date.now() - 1000, updatedAt: Date.now(), ...extra
  };
  return d;
};

/* ═══ 1. The rules actually enforce it ════════════════════
   The one thing no browser test can exercise: expiry lives in
   firestore.rules, on the server's clock. Assert the clause is
   there, because losing it would silently hand out free access. */
{
  const rules = readFileSync('firestore.rules', 'utf8');
  check(/function subActive\(\)/.test(rules), 'rules: subActive() exists');
  check(/subUntil', 0\) > request\.time\.toMillis\(\)/.test(rules),
        'rules: expiry is checked against the SERVER clock, not the client');
  check(/materialId in studentDoc\(\)\.data\.get\('files', \[\]\) \|\| subActive\(\)/.test(rules),
        'rules: a grant OR a live plan — neither cancels the other');
  const studentsBlock = rules.slice(rules.indexOf('match /students/'));
  check(/allow read, write: if isAdmin\(\);/.test(studentsBlock.slice(0, 200)),
        'rules: subUntil is admin-write only, so nobody grants themselves a plan');
}

/* ═══ 2. The plans page ═══════════════════════════════════ */
{
  const page = await openPage(browser, { who: 'student', db: fixture() });
  await page.goto(BASE + 'plans.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.plan-card', { timeout: 10000 });

  const text = await page.textContent('#content');
  check(/₹69\.00/.test(text), 'plans: weekly is ₹69');
  check(/₹199\.00/.test(text), 'plans: monthly is ₹199');
  check(/7 days/.test(text) && /30 days/.test(text), 'plans: both periods shown');

  const best = await page.textContent('.plan-card.is-best h2');
  check(best.trim() === 'Monthly', 'plans: monthly flagged as the better value', best.trim());
  const flags = await page.$$eval('.plan-flag', f => f.length);
  check(flags === 1, 'plans: only one plan is flagged', 'flags=' + flags);
  check(page.errors.length === 0, 'plans: no JS errors', page.errors.join(' ; '));
  await page.close();
}

/* ═══ 3. Buying one creates the right order ═══════════════
   The order is inspected by calling the module directly, not by
   reading it back after the redirect: addInitScript re-seeds the
   mock database on every navigation, so anything the previous
   page wrote is gone by the time checkout loads. */
{
  const page = await openPage(browser, { who: 'student', db: fixture() });
  await page.goto(BASE + 'plans.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.plan-card', { timeout: 10000 });

  const o = await page.evaluate(async () => {
    const { createSubscriptionOrder } = await import('./assets/js/orders.js');
    return createSubscriptionOrder({ email: 'student@example.com', planId: 'monthly' });
  });
  check(o.kind === 'subscription', 'buy: marked as a subscription', String(o.kind));
  check(o.plan === 'monthly' && o.planDays === 30, 'buy: carries the plan and its length');
  check(o.totalPaise === 19900, 'buy: priced in paise', String(o.totalPaise));
  check(o.status === 'pending_payment', 'buy: starts unpaid', o.status);
  check(/^CK-/.test(o.orderNo) && !!o.txnRef, 'buy: has an order number and UPI reference');
  check(o.items.length === 1 && o.items[0].id === 'plan:monthly',
        'buy: one synthetic line item, named as a plan', JSON.stringify(o.items));

  const bad = await page.evaluate(async () => {
    const { createSubscriptionOrder } = await import('./assets/js/orders.js');
    try { await createSubscriptionOrder({ email: 'x@y.com', planId: 'yearly' }); return 'ALLOWED'; }
    catch (e) { return e.message; }
  });
  check(bad !== 'ALLOWED', 'buy: an unknown plan is refused', bad);

  // and the button really does lead to checkout
  await page.click('.plan-card.is-best button');
  await page.waitForTimeout(1500);
  check(/checkout\.html\?order=/.test(page.url()), 'buy: sent to checkout', page.url());
  await page.close();
}

/* ═══ 3b. Checkout pays for it like any other order ═══════ */
{
  const page = await openPage(browser, { who: 'student', db: awaiting(fixture(),
    { status: 'pending_payment' }) });
  await page.goto(BASE + 'checkout.html?order=o-sub', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const shown = await page.textContent('#content');
  check(/₹199\.00/.test(shown), 'checkout: shows the plan amount', shown.trim().slice(0, 60));
  check(/CK-260101-AAAA/.test(shown), 'checkout: carries the order number into the payment');
  check(/test@upi/.test(shown), 'checkout: pays the configured UPI id');
  await page.close();
}

/* ═══ 4. The admin confirming it starts the plan ══════════ */
{
  const page = await openPage(browser, { who: 'admin', db: awaiting(fixture()) });
  page.on('dialog', d => d.accept());
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="payments"]');
  await page.waitForTimeout(1200);

  const queue = await page.textContent('#pending-list').catch(() => '');
  check(/30-day plan/.test(queue), 'admin: the queue says it is a plan, not a material',
        queue.trim().slice(0, 80));

  await page.click('#pending-list button:has-text("Confirm payment")');
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => ({
    stu: window.__MOCK_DB__.students['student@example.com'],
    order: window.__MOCK_DB__.orders['o-sub'],
    ledger: Object.values(window.__MOCK_DB__.ledger)
  }));
  const days = (after.stu.subUntil - Date.now()) / DAY;
  check(after.order.status === 'paid', 'confirm: order marked paid', after.order.status);
  check(days > 29.9 && days < 30.1, 'confirm: 30 days of access granted', days.toFixed(2) + ' days');
  check(after.stu.subPlan === 'monthly', 'confirm: the plan is recorded', String(after.stu.subPlan));
  check(!after.stu.files.includes('plan:monthly'),
        'confirm: the plan line item did NOT leak into files[]', JSON.stringify(after.stu.files));
  check(after.ledger.some(e => e.type === 'charge' && e.amountPaise === 19900),
        'confirm: the ledger records the charge');
  await page.close();
}

/* ═══ 5. Renewing early adds on, it does not reset ════════ */
{
  const db = awaiting(withSub(fixture(), 12 * DAY));
  const page = await openPage(browser, { who: 'admin', db });
  page.on('dialog', d => d.accept());
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="payments"]');
  await page.waitForTimeout(1200);
  await page.click('#pending-list button:has-text("Confirm payment")');
  await page.waitForTimeout(1500);

  const until = await page.evaluate(() => window.__MOCK_DB__.students['student@example.com'].subUntil);
  const days = (until - Date.now()) / DAY;
  check(days > 41.9 && days < 42.1, 'renew: 12 days left + 30 bought = 42, not 30',
        days.toFixed(2) + ' days');
  await page.close();
}

/* ═══ 6. What a live plan opens ═══════════════════════════ */
{
  const page = await openPage(browser, { who: 'student', db: withSub(fixture(), 10 * DAY) });
  await page.goto(BASE + 'library.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const lib = await page.textContent('#content');
  check(/Added After You Subscribed/.test(lib),
        'plan: a material published later is in the library — the whole point of a date');
  check(/Paid Material/.test(lib), 'plan: ungranted paid material is open too');
  check(/10 days left/.test(await page.textContent('#plan-note')),
        'plan: the library says how long is left',
        (await page.textContent('#plan-note')).trim().slice(0, 60));
  await page.close();
}

/* ═══ 7. …and what the store looks like ═══════════════════ */
{
  const page = await openPage(browser, { who: 'student', db: withSub(fixture(), 3 * DAY) });
  await page.goto(BASE + 'store.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.tile', { timeout: 10000 });
  await page.waitForTimeout(900);

  const tiles = await page.textContent('#content');
  check(/In your plan/.test(tiles), 'store: tiles say the plan is why they are open');
  const buys = await page.$$eval('#content button', b =>
    b.filter(x => /Add to cart/.test(x.textContent)).length);
  check(buys === 0, 'store: nothing left to buy while subscribed', 'buttons=' + buys);

  const strip = await page.textContent('#plan-strip');
  check(/3 days left/.test(strip), 'store: the strip counts down', strip.trim().slice(0, 60));

  const sampleShown = await page.$eval('#sample-banner', e => !e.hidden).catch(() => false);
  check(!sampleShown, 'store: no free-sample pitch to someone who already pays');
  await page.close();
}

/* ═══ 8. A lapsed plan keeps what was bought outright ═════ */
{
  const page = await openPage(browser, { who: 'student', db: withSub(fixture(), -2 * DAY) });
  await page.goto(BASE + 'library.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const lib = await page.textContent('#content');
  // Practice Paper, not Chapter 1 Notes: the latter sits inside a
  // folder, so the root view shows the folder's name instead.
  check(/Practice Paper/.test(lib), 'lapsed: materials bought outright are still there');
  check(!/Added After You Subscribed/.test(lib), 'lapsed: the catalogue is closed again');
  check(/plan ended/i.test(await page.textContent('#plan-note')), 'lapsed: the library says so');

  await page.goto(BASE + 'store.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const strip = await page.textContent('#plan-strip');
  check(/ended/i.test(strip), 'lapsed: the store offers to start it again', strip.trim().slice(0, 50));
  await page.close();
}

/* ═══ 9. The preview page names the reason ════════════════ */
{
  const a = await openPage(browser, { who: 'student', db: withSub(fixture(), 5 * DAY) });
  await a.goto(BASE + 'material.html?id=m-secret', { waitUntil: 'networkidle' });
  await a.waitForSelector('.preview-buy', { timeout: 10000 });
  check(/Included in your plan/.test(await a.textContent('.preview-buy')),
        'preview: says the plan is why it is open');
  await a.close();

  const b = await openPage(browser, { who: 'student', db: fixture() });
  await b.goto(BASE + 'material.html?id=m-secret', { waitUntil: 'networkidle' });
  await b.waitForSelector('.preview-buy', { timeout: 10000 });
  check(/see plans/.test(await b.textContent('#content')),
        'preview: a non-subscriber is told the plan exists');
  await b.close();
}

/* ═══ 10. Refunding a plan takes the days back ════════════ */
{
  const db = withSub(fixture(), 40 * DAY);
  db.orders['o-paid'] = { ...awaiting(fixture()).orders['o-sub'], status: 'paid', paidAt: Date.now() };
  const page = await openPage(browser, { who: 'admin', db });
  page.on('dialog', d => d.accept('Test refund'));
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="payments"]');
  await page.waitForTimeout(1200);
  await page.click('#orders-list button:has-text("Refund")');
  await page.waitForTimeout(1500);

  const out = await page.evaluate(() => ({
    until: window.__MOCK_DB__.students['student@example.com'].subUntil,
    order: window.__MOCK_DB__.orders['o-paid']
  }));
  const left = (out.until - Date.now()) / DAY;
  check(out.order.status === 'refunded', 'refund: order marked refunded', out.order.status);
  check(left > 9.9 && left < 10.1, 'refund: 40 days − 30 bought = 10 left, not zero',
        left.toFixed(2) + ' days');
  await page.close();
}

/* ═══ 11. Plan orders on the student's orders page ════════ */
{
  const db = withSub(fixture(), 20 * DAY);
  db.orders['o-paid'] = { ...awaiting(fixture()).orders['o-sub'], status: 'paid', paidAt: Date.now() };
  const page = await openPage(browser, { who: 'student', db });
  await page.goto(BASE + 'orders.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const text = await page.textContent('#content');
  check(/Plan/.test(text), 'orders: a plan order is badged as one');
  const links = await page.$$eval('#content a', a => a.map(x => x.getAttribute('href')));
  check(!links.some(h => /viewer\.html\?id=plan/.test(h || '')),
        'orders: no broken "open" link to a plan id', links.join(' '));
  check(links.some(h => /library\.html/.test(h || '')), 'orders: points at My Materials instead');
  await page.close();
}

/* ═══ 12. Buying a single material still works ════════════ */
{
  const d = fixture();
  d.orders['o-mat'] = {
    orderNo: 'CK-260101-BBBB', txnRef: 'CK260101BBBBXYZ', email: 'student@example.com',
    items: [{ id: 'm-secret', title: 'Paid Material (not granted)', pricePaise: 25000 }],
    totalPaise: 25000, status: 'awaiting_confirmation',
    createdAt: Date.now() - 1000, updatedAt: Date.now()
  };
  const page = await openPage(browser, { who: 'admin', db: d });
  page.on('dialog', dlg => dlg.accept());
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="payments"]');
  await page.waitForTimeout(1200);
  await page.click('#pending-list button:has-text("Confirm payment")');
  await page.waitForTimeout(1500);

  const stu = await page.evaluate(() => window.__MOCK_DB__.students['student@example.com']);
  check(stu.files.includes('m-secret'), 'materials: a one-off purchase still grants the id',
        JSON.stringify(stu.files));
  check(!stu.subUntil, 'materials: and does not start a plan', String(stu.subUntil));
  await page.close();
}

/* ═══ 13. Paying before the admin ever added you ══════════ */
{
  const d = fixture();
  delete d.students['student@example.com'];          // never added by the admin
  d.orders['o-new'] = {
    orderNo: 'CK-260101-CCCC', txnRef: 'CK260101CCCCXYZ', email: 'student@example.com',
    kind: 'subscription', plan: 'weekly', planDays: 7,
    items: [{ id: 'plan:weekly', title: 'Weekly plan', pricePaise: 6900 }],
    totalPaise: 6900, status: 'awaiting_confirmation',
    createdAt: Date.now() - 1000, updatedAt: Date.now()
  };
  const page = await openPage(browser, { who: 'admin', db: d });
  page.on('dialog', dlg => dlg.accept());
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="payments"]');
  await page.waitForTimeout(1200);
  await page.click('#pending-list button:has-text("Confirm payment")');
  await page.waitForTimeout(1500);

  const stu = await page.evaluate(() => window.__MOCK_DB__.students['student@example.com']);
  const days = stu ? (stu.subUntil - Date.now()) / DAY : 0;
  check(!!stu, 'stranger: the student document is created rather than erroring');
  check(days > 6.9 && days < 7.1, 'stranger: the week they paid for starts', days.toFixed(2) + ' days');
  await page.close();
}

/* ═══ 14. The admin can adjust a plan by hand ═════════════ */
{
  const page = await openPage(browser, { who: 'admin', db: fixture() });
  page.on('dialog', d => d.type() === 'confirm' ? d.accept() : d.accept('1'));  // +7 days
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.click('#students-list button:has-text("Plan")');
  await page.waitForTimeout(1300);

  const until = await page.evaluate(() => window.__MOCK_DB__.students['student@example.com'].subUntil);
  const days = (until - Date.now()) / DAY;
  check(days > 6.9 && days < 7.1, 'admin: a week granted by hand', days.toFixed(2) + ' days');
  await page.close();
}

await browser.close();
process.exit(report() ? 1 : 0);
