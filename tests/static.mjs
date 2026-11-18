// Static audit: no browser. Checks that what the files reference
// actually exists, and that nothing stale was left behind.
import { readFileSync, existsSync, readdirSync } from 'fs';
const results = [];
const check = (c, n, d = '') => results.push([c ? 'PASS' : 'FAIL', n, d]);

const HTML = readdirSync('.').filter(f => f.endsWith('.html'));
const JS   = readdirSync('assets/js').map(f => 'assets/js/' + f);

/* ── 1. every local href/src resolves ─────────────────── */
for (const f of HTML) {
  const src = readFileSync(f, 'utf8');
  const refs = [...src.matchAll(/\s(?:href|src)="(?!https?:|data:|mailto:|upi:|#)([^"]+)"/g)]
    .map(m => m[1].split('?')[0].split('#')[0])
    .filter(Boolean);
  const missing = [...new Set(refs)].filter(r => !existsSync(r));
  check(missing.length === 0, `links: ${f}`, missing.join(', '));
}

/* ── 2. every ES import resolves ──────────────────────── */
for (const f of [...HTML, ...JS]) {
  const src = readFileSync(f, 'utf8');
  const base = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
  const imports = [...src.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)].map(m => m[1]);
  const missing = imports
    .map(i => (i.startsWith('./assets') ? i.slice(2) : base + i.slice(2)))
    .filter(p => !existsSync(p));
  check(missing.length === 0, `imports: ${f}`, missing.join(', '));
}

/* ── 3. service worker shell matches reality ──────────── */
{
  const sw = readFileSync('sw.js', 'utf8');
  const block = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL')));
  const shell = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(p => p !== './');
  const missing = shell.filter(p => !existsSync(p));
  check(missing.length === 0, 'sw: every cached file exists', missing.join(', '));

  const pages = HTML.filter(f => f !== 'google308599dd9c6ed780.html');
  const uncached = pages.filter(p => !sw.includes(`'${p}'`));
  check(uncached.length === 0, 'sw: every page is in the shell', uncached.join(', '));

  const jsUncached = JS.filter(p => !sw.includes(p));
  check(jsUncached.length === 0, 'sw: every module is in the shell', jsUncached.join(', '));
}

/* ── 4. private pages are noindex and disallowed ──────── */
{
  const robots = readFileSync('robots.txt', 'utf8');
  for (const f of HTML) {
    if (f === 'index.html' || f.startsWith('google')) continue;
    const src = readFileSync(f, 'utf8');
    check(/name="robots"\s+content="noindex"/.test(src), `seo: ${f} is noindex`);
    check(robots.includes('Disallow: /' + f), `seo: ${f} is in robots.txt`);
  }
  check(/name="robots"/.test(readFileSync('index.html', 'utf8')) === false,
        'seo: the landing page is still indexable');
  check(/Sitemap:\s*https:\/\/chapterkit\.vercel\.app/.test(robots), 'seo: sitemap line present');
}

/* ── 5. nothing stale left behind ─────────────────────── */
{
  const all = [...HTML, ...JS, 'firestore.rules', 'README.md']
    .map(f => [f, readFileSync(f, 'utf8')]);
  for (const [name, pattern] of [
    ['materialSample', /materialSample/],
    ['DESCRIPTION_LIMIT', /DESCRIPTION_LIMIT/],
    ['StudyVault branding', /StudyVault|Study Vault|PrepDeck|Paathkosh/],
  ]) {
    const hits = all.filter(([f, s]) => pattern.test(s)).map(([f]) => f);
    check(hits.length === 0, `stale: no ${name} left`, hits.join(', '));
  }
  // the cart key is the one StudyVault-era string that must NOT change
  check(readFileSync('assets/js/cart.js', 'utf8').includes('studyvault.cart.v1'),
        'stale: the localStorage cart key is deliberately unchanged');
}

/* ── 6. admin email agrees between client and rules ───── */
{
  const cfg = readFileSync('assets/js/config.js', 'utf8');
  const rules = readFileSync('firestore.rules', 'utf8');
  const a = cfg.match(/ADMIN_EMAIL\s*=\s*"([^"]+)"/)?.[1];
  const b = rules.match(/adminEmail\(\)\s*\{\s*return\s*"([^"]+)"/)?.[1];
  check(!!a && a === b, 'config: ADMIN_EMAIL matches the rules', `${a} vs ${b}`);
}

/* ── 7. rules cover every collection the code touches ─── */
{
  const rules = readFileSync('firestore.rules', 'utf8');
  const used = new Set();
  for (const f of [...HTML, ...JS]) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:collection|doc)\(db,\s*'([a-zA-Z]+)'/g)) used.add(m[1]);
  }
  const uncovered = [...used].filter(c => !rules.includes(`match /${c}/`));
  check(uncovered.length === 0, 'rules: every collection the code uses has a match block',
        uncovered.join(', ') || [...used].sort().join(' '));
}

for (const [s, n, d] of results) console.log(`${s === 'PASS' ? '  ok  ' : '  FAIL'}  ${n}${d ? '   — ' + d : ''}`);
const f = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - f}/${results.length} passed`);
process.exit(f ? 1 : 0);
