// Every page loads clean, for a student and for the admin.
import { launch, openPage, fixture, BASE, suite } from './harness.mjs';
const { check, report } = suite();
const browser = await launch();

const pages = ['index.html', 'library.html', 'store.html', 'material.html?id=m-secret',
               'plans.html', 'cart.html', 'checkout.html', 'orders.html',
               'request.html', 'admin.html'];

for (const who of ['student', 'admin']) {
  for (const p of pages) {
    if (p === 'admin.html' && who === 'student') continue;
    const page = await openPage(browser, { who, db: fixture() });
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const bad = page.errors.filter(e => !/favicon|sw\.js|ServiceWorker/i.test(e));
    check(bad.length === 0, `${who}: ${p}`, bad.join(' ; ').slice(0, 120));
    await page.close();
  }
}

await browser.close();
process.exit(report() ? 1 : 0);
