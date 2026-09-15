# StudyVault

A private library where students sign in with Google and read only the study
materials assigned to them. Static files + Firebase (Auth + Firestore) — no
server to run.

## Pages

| File | Who | What |
|---|---|---|
| `index.html` | public | Landing page + Google sign-in. Signed-in users are redirected on. |
| `store.html` | signed in | Catalogue of materials on sale, with subject filters and search. |
| `cart.html` | signed in | Cart contents and order total. |
| `checkout.html` | signed in | Places the order, shows the UPI QR / link, takes the payment reference. |
| `orders.html` | signed in | The student's own orders and payment status. |
| `library.html` | student / admin | "My Materials" — folders, breadcrumbs, grid. |
| `viewer.html?id=<id>` | student / admin | Secure viewer (HTML, JSX/TSX, PDF). |
| `admin.html` | admin only | Students, access, folders, materials, pricing, maintenance. |

Shared code lives in `assets/js/` (`config`, `firebase`, `ui`, `session`,
`content`, `render`, `cart`) and `assets/css/app.css`.

## Data model

```
students/{email}        { email, name, files: [materialId], addedAt }
folders/{id}            { name, parentId, createdAt }
materials/{id}          { title, tag, folderId, kind, createdAt,
                          pricePaise, published }                      ← metadata
materialContent/{id}    { htmlContent | jsxContent | pdfContent | url } ← the bytes
```

**Prices are integers in paise** (`₹299.00` → `29900`), so totals never suffer
floating-point error. `pricePaise: null` means *not for sale* — the material is
instructor-assigned only and never appears in the store. `published: false`
hides it from the store without clearing the price.

**The cart lives in `localStorage`**, holding ids only — never prices. It is
per-device and disposable; the durable record is the order, created at
checkout. Prices are re-read from Firestore every time the cart is shown, so
editing the stored cart cannot change what anything costs. Items already owned,
delisted, or unknown are pruned automatically.

**Why content is a separate collection.** Firestore rules cannot filter a
collection query — a rule that depends on per-document data makes the whole
query fail instead of returning the allowed subset. So the browsable catalogue
(`materials`) is readable by any signed-in user, while the part worth paying
for (`materialContent`) is fetched one document at a time and gated on the
caller having that id in their `files[]`.

Without this split, *any signed-in user could read every material* straight
from Firestore, because the `files[]` filter was only applied in the browser.

## Deploying

1. **Publish the rules first.** Firebase Console → Firestore → Rules → paste
   `firestore.rules` → Publish.
2. **Then run the migration.** Admin panel → Maintenance → *Run migration*.
   It copies inline content into `materialContent`, verifies each copy, and
   only then removes the original. Safe to run more than once.
3. Upload the site files to your host (Firebase Hosting, GitHub Pages, Netlify).

> Do not migrate before publishing the rules. The old rules have no match for
> `materialContent`, so Firestore denies it by default and students would see
> "no access" until the new rules land. In the other order nothing breaks:
> before migration the viewer falls back to the old inline content.

If you change `ADMIN_EMAIL` in `assets/js/config.js`, change `adminEmail()` in
`firestore.rules` too. The client constant grants nothing on its own — every
privileged read and write is checked server-side.

## Adding materials

- **Upload** — `.html`, `.jsx`, `.tsx` up to ~900 KB; `.pdf` up to **700 KB**
  (base64 inflates binaries ~33% and Firestore caps a document at 1 MiB).
- **GitHub URL** — a `raw.githubusercontent.com` link from a **public** repo.
  Fetched when opened, so there is no size limit. Use this for large PDFs.
- `.jsx` / `.tsx` must define a component named `App` (or use a default
  export). React, ReactDOM and Babel load in the sandboxed viewer; there is no
  bundler, so imports are stripped.

## Payments

There is no payment gateway. UPI cannot call back into a static site, so
**payments are confirmed by hand**: the student pays, submits the reference
number their UPI app gave them, and you approve it in Admin → Payments, which
grants access and writes a ledger entry.

Set your UPI ID in **Admin → Payments → UPI settings**. It is stored in
`settings/payment`, not in the code, so you can change it without a redeploy.

```
settings/payment    { upiVpa, payeeName, enabled, updatedAt }
orders/{id}         { orderNo, txnRef, email, items[], totalPaise, status,
                      utr, createdAt, paidAt, confirmedBy, … }
ledger/{id}         { orderId, orderNo, email, type, amountPaise, note, at }
```

**Order lifecycle**

```
pending_payment ──submit reference──> awaiting_confirmation
      │                                      │
      │                              approve │ reject
   cancel/expire                             ▼
      ▼                                    paid ──refund──> refunded
 cancelled / expired                     rejected
```

**Each order carries its own reference.** The QR and `upi://` link embed the
exact amount and a `tr=` reference derived from the order number, so payments
arrive already identified. That is the difference between reconciliation taking
seconds and being guesswork over timestamps.

**Checks shown before you approve** — none of them block you, they just surface
things worth a second look:

- the same UPI reference already used on another order (one payment, one order)
- the order total not matching current prices, or not matching its own line items
- orders older than 24 hours

**Refunds** record the reversal and revoke access, but only for materials no
*other* paid order also covers — refunding one order can't strip something the
student bought separately. Money is **not** moved for you; send it back yourself.

**Swapping in a real gateway later.** Everything funnels through
`confirmPayment()` in `assets/js/orders.js`. Manual approval calls it with
`method:'manual'`; a gateway webhook would call the same function with
`method:'gateway'` and its own reference, and nothing else would change.

> A personal UPI ID is not a merchant account. Collecting business payments on
> one runs against NPCI merchant rules and most apps' terms, has low inbound
> limits, and accounts do get frozen — which would strand paying students. The
> UPI ID is configuration precisely so it is quick to change.

## A note on "no download"

The viewer disables right-click and the usual save shortcuts, and PDFs are
painted to `<canvas>` with no text layer or browser PDF toolbar. That deters
casual copying — it is not DRM. Anything a browser can display can be
recovered by a determined user. The protection that actually matters is the
Firestore rules, which stop people reading material they were never granted.
