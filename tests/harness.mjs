// ═══════════════════════════════════════════════════════════
//  Shared Playwright harness: serves the real repo over HTTP and
//  stubs Firebase so no network and no live project is needed.
//
//  Lives in the repo, not a temp directory — an earlier copy was
//  lost to a scratchpad wipe along with every suite that used it.
// ═══════════════════════════════════════════════════════════
import { chromium } from 'playwright-core';
import { FIREBASE_APP, FIREBASE_AUTH, FIREBASE_FIRESTORE } from './mockfb.mjs';

export const BASE = process.env.CK_BASE || 'http://localhost:8811/';

const CHROME = process.env.CK_CHROME
  || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';

export const DAY = 24 * 60 * 60 * 1000;

export function fixture() {
  return {
    students: {
      'student@example.com': {
        email: 'student@example.com', name: 'Sam Student',
        files: ['m-html', 'm-pdf'], addedAt: Date.now() - 86400000
      }
    },
    folders: {
      'f-algebra': { name: 'Algebra', parentId: null, createdAt: Date.now() }
    },
    materials: {
      'm-html':   { title: 'Chapter 1 Notes', tag: 'Maths', folderId: 'f-algebra',
                    createdAt: Date.now() - 172800000, kind: 'html' },
      'm-pdf':    { title: 'Practice Paper', tag: 'Maths', folderId: null,
                    createdAt: Date.now() - 86400000, kind: 'html' },
      'm-secret': { title: 'Paid Material (not granted)', tag: 'Physics', folderId: null,
                    createdAt: Date.now(), kind: 'html', hasCover: true,
                    pricePaise: 25000, published: true },
      'm-new':    { title: 'Added After You Subscribed', tag: 'Physics', folderId: null,
                    createdAt: Date.now(), kind: 'html',
                    pricePaise: 15000, published: true }
    },
    materialCover: {
      'm-secret': { dataUrl: 'data:image/gif;base64,R0lGODlhAgABAPABAP8AAAAA/yH5BAAAAAAALAAAAAACAAEAAAICBAoAOw==',
                    updatedAt: Date.now() }
    },
    materialContent: {
      'm-html':   { htmlContent: '<h1>Chapter 1</h1>', sourceType: 'inline' },
      'm-pdf':    { htmlContent: '<h1>Practice</h1>', sourceType: 'inline' },
      'm-secret': { htmlContent: '<h1>SECRET PAID CONTENT</h1>', sourceType: 'inline' },
      'm-new':    { htmlContent: '<h1>New</h1>', sourceType: 'inline' }
    },
    settings: { payment: { upiVpa: 'test@upi', payeeName: 'Test', enabled: true,
                           updatedAt: Date.now() } },
    orders: {}, ledger: {}, requests: {}
  };
}

export const USERS = {
  student: { email: 'student@example.com', displayName: 'Sam Student', photoURL: null },
  admin:   { email: 'abi.abilashv0805@gmail.com', displayName: 'Abilash', photoURL: null },
  none:    null
};

export async function launch() {
  return chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--no-proxy-server']
  });
}

/**
 * Open a page with Firebase and the web fonts stubbed.
 *   who    key of USERS
 *   db     fixture object, seeded into window.__MOCK_DB__
 *   rules  optional (collection, id, filtered) => boolean; false denies
 */
export async function openPage(browser, { who = 'student', db = fixture(), rules = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });

  await ctx.route('**/firebasejs/**/firebase-app.js', r =>
    r.fulfill({ contentType: 'application/javascript', body: FIREBASE_APP }));
  await ctx.route('**/firebasejs/**/firebase-auth.js', r =>
    r.fulfill({ contentType: 'application/javascript', body: FIREBASE_AUTH }));
  await ctx.route('**/firebasejs/**/firebase-firestore.js', r =>
    r.fulfill({ contentType: 'application/javascript', body: FIREBASE_FIRESTORE }));
  await ctx.route('**fonts.googleapis.com**', r =>
    r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('**fonts.gstatic.com**', r => r.abort());
  await ctx.route('**cdnjs.cloudflare.com**', r =>
    r.fulfill({ contentType: 'application/javascript', body: '' }));

  const page = await ctx.newPage();
  await page.addInitScript(({ user, database, rulesSrc }) => {
    window.__MOCK_USER__ = user;
    window.__MOCK_DB__ = database;
    window.__MOCK_RULES__ = rulesSrc ? new Function('return ' + rulesSrc)() : null;
  }, { user: USERS[who], database: db, rulesSrc: rules ? rules.toString() : null });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.errors = errors;
  return page;
}

/* ── a tiny assertion recorder ────────────────────────── */
export function suite() {
  const results = [];
  return {
    check: (cond, name, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]),
    report(browser) {
      for (const [s, n, d] of results) {
        console.log(`${s === 'PASS' ? '  ok  ' : '  FAIL'}  ${n}${d ? '   — ' + d : ''}`);
      }
      const failed = results.filter(r => r[0] === 'FAIL').length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      return failed;
    }
  };
}
