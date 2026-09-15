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

const NAV = [
  { id: 'store',   href: 'store.html',   icon: '🛍️', label: 'Store' },
  { id: 'library', href: 'library.html', icon: '📚', label: 'My Materials' },
  { id: 'request', href: 'request.html', icon: '💡', label: 'Request' },
  { id: 'orders',  href: 'orders.html',  icon: '🧾', label: 'Orders' },
  { id: 'cart',    href: 'cart.html',    icon: '🛒', label: 'Cart', badge: true },
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
      el('button', {
        class: 'hamburger', 'aria-label': 'Open menu',
        onclick: () => toggleDrawer(true)
      }, '☰'),
      el('a', { class: 'brand', href: 'library.html' },
        el('img', { src: 'icon-192.png', alt: '' }),
        'Study', el('span', {}, 'Vault')
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
  document.body.append(drawer, backdrop);
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
