// ═══════════════════════════════════════════════════════════
//  Shared UI — escaping, formatting, toasts, and the site
//  chrome (header + mobile drawer) that every page mounts.
// ═══════════════════════════════════════════════════════════
import { SITE_NAME } from './config.js';

/* ── primitives ───────────────────────────────────────── */

export function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

// Money is stored in paise (integers) so arithmetic never hits float error.
export function fmtMoney(paise) {
  const n = Number(paise || 0) / 100;
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let _toastTimer = null;
export function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast'; }, 3600);
}

/** Replace an element's children with freshly built nodes. */
export function fill(el, ...nodes) {
  el.replaceChildren(...nodes);
  return el;
}

/** Build an element: el('div', {class:'x'}, child, 'text') */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function emptyState(icon, title, detail) {
  return el('div', { class: 'empty' },
    el('span', { class: 'empty-ico' }, icon),
    el('strong', {}, title),
    detail ? el('span', {}, detail) : null
  );
}

/* ── site chrome ──────────────────────────────────────── */

// `primary` items get a slot in the mobile bottom bar. Everything else
// lives behind "More", which opens the same drawer.
const NAV = [
  { id: 'store',   href: 'store.html',   icon: '🛍️', label: 'Store',        primary: true },
  { id: 'library', href: 'library.html', icon: '📚', label: 'My Materials', primary: true, shortLabel: 'Materials' },
  { id: 'request', href: 'request.html', icon: '💡', label: 'Request',      primary: true },
  { id: 'cart',    href: 'cart.html',    icon: '🛒', label: 'Cart', badge: true, primary: true },
  { id: 'orders',  href: 'orders.html',  icon: '🧾', label: 'Orders' },
  { id: 'admin',   href: 'admin.html',   icon: '⚙',  label: 'Admin', adminOnly: true }
];

function navButtons(active, isAdmin) {
  return NAV
    .filter(n => !n.adminOnly || isAdmin)
    .map(n => {
      const link = el('a', {
        class: 'nav-link' + (n.id === active ? ' active' : ''),
        href: n.href
      }, el('span', { 'aria-hidden': 'true' }, n.icon), n.label);
      if (n.badge) link.append(el('span', { class: 'cart-count', hidden: true }, '0'));
      return link;
    });
}

/** Keep every cart badge on the page in sync. */
export function setCartCount(n) {
  document.querySelectorAll('.cart-count').forEach(b => {
    b.textContent = String(n);
    b.hidden = !n;
  });
}

/**
 * Mobile bottom tab bar.
 *
 * A hamburger hides navigation behind a gesture people have to already
 * know about; a bottom bar is the pattern every app on the phone uses,
 * so the destinations are simply visible. "More" opens the drawer for
 * the rest.
 */
function bottomNav(active, isAdmin, onMore) {
  const items = NAV.filter(n => n.primary && (!n.adminOnly || isAdmin));

  const tabs = items.map(n => {
    const tab = el('a', {
      class: 'bn-item' + (n.id === active ? ' active' : ''),
      href: n.href,
      'aria-current': n.id === active ? 'page' : null
    },
      el('span', { class: 'bn-ico', 'aria-hidden': 'true' }, n.icon),
      el('span', {}, n.shortLabel || n.label)
    );
    if (n.badge) tab.append(el('span', { class: 'cart-count', hidden: true }, '0'));
    return tab;
  });

  // "More" is active whenever the current page isn't one of the tabs.
  const onMorePage = !items.some(n => n.id === active);
  tabs.push(el('button', {
    class: 'bn-item' + (onMorePage ? ' active' : ''),
    'aria-label': 'More options',
    onclick: onMore
  },
    el('span', { class: 'bn-ico', 'aria-hidden': 'true' }, '☰'),
    el('span', {}, 'More')
  ));

  return el('nav', { class: 'bottom-nav', 'aria-label': 'Main' }, ...tabs);
}

/**
 * Mounts the header (and mobile drawer) into #site-header.
 * Call once per page after auth state is known.
 */
export function mountChrome({ active, user, isAdmin, onSignOut }) {
  const host = document.getElementById('site-header');
  if (!host) return;

  const initials = (user?.displayName || user?.email || '?')
    .split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const avatar = el('div', { class: 'avatar' });
  if (user?.photoURL) {
    avatar.append(el('img', { src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' }));
  } else {
    avatar.textContent = initials;
  }

  const drawer = el('aside', { class: 'drawer', id: 'drawer' },
    el('div', { class: 'drawer-head' },
      el('span', { class: 'brand' }, SITE_NAME),
      el('button', {
        class: 'hamburger', 'aria-label': 'Close menu',
        onclick: () => toggleDrawer(false)
      }, '✕')
    ),
    ...navButtons(active, isAdmin),
    el('div', { class: 'drawer-spacer' }),
    el('button', {
      class: 'nav-link', style: 'color:var(--danger)',
      onclick: onSignOut
    }, el('span', { 'aria-hidden': 'true' }, '↪'), 'Sign out')
  );

  const backdrop = el('div', {
    class: 'drawer-backdrop', id: 'drawer-backdrop',
    onclick: () => toggleDrawer(false)
  });

  const header = el('header', { class: 'site-header' },
    el('div', { class: 'site-header-inner' },
      el('a', { class: 'brand', href: 'library.html' },
        el('img', { src: 'icon-192.png', alt: '' }),
        'Chapter\u00A0', el('span', {}, 'Kit')
      ),
      el('nav', { class: 'nav' }, ...navButtons(active, isAdmin)),
      el('div', { class: 'header-right' },
        isAdmin ? el('span', { class: 'badge-admin' }, 'Admin') : null,
        el('div', { class: 'user-chip' }, avatar,
          el('span', { class: 'user-chip-email' }, user?.email || '')),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: onSignOut }, 'Sign out')
      )
    )
  );

  host.replaceWith(header);
  document.body.append(drawer, backdrop,
    bottomNav(active, isAdmin, () => toggleDrawer(true)));
  // reserves space so the bar never covers the last row of content
  document.body.classList.add('has-bottom-nav');
}

export function toggleDrawer(open) {
  const d = document.getElementById('drawer');
  const b = document.getElementById('drawer-backdrop');
  if (!d) return;
  const next = open === undefined ? !d.classList.contains('open') : open;
  d.classList.toggle('open', next);
  b?.classList.toggle('open', next);
}

/** Reveal the page once auth is resolved (see .booting in app.css). */
export function ready() {
  document.documentElement.classList.remove('booting');
}

/**
 * Turn a Firebase error into something a student can act on.
 *
 * Raw SDK strings ("Missing or insufficient permissions.") are
 * meaningless to the person reading them and alarming on a page
 * they've done nothing wrong on. The admin gets the real cause,
 * since for them it almost always means the rules need publishing.
 */
export function friendlyError(e, { isAdmin = false } = {}) {
  const code = e?.code || '';
  const msg  = e?.message || '';

  if (code === 'permission-denied' || /insufficient permissions/i.test(msg)) {
    return isAdmin
      ? 'Firestore refused this. Your security rules are probably out of date — ' +
        'publish the current firestore.rules from the repo.'
      : 'You don\'t have access to this yet. If that looks wrong, contact your instructor.';
  }
  if (code === 'unauthenticated') {
    return 'Your session expired. Please sign in again.';
  }
  if (code === 'unavailable' || code === 'deadline-exceeded' || /network/i.test(msg)) {
    return 'Couldn\'t reach the server. Check your connection and try again.';
  }
  if (code === 'resource-exhausted') {
    return 'The service is busy right now. Please try again in a minute.';
  }
  return msg || 'Something went wrong. Please try again.';
}
