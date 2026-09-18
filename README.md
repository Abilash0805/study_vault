# Chapter Kit

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
| `request.html` | signed in | Ask for a chapter that doesn't exist yet; track its status. |
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
**payments are confirmed by hand**: the student pays, taps "I have paid", and
you approve it in Admin → Payments, which grants access and writes a ledger
entry.

The QR puts the order number in the payment note (`Chapter Kit CK-260915-K7Q2`),
so payments normally arrive already identifying themselves and the student has
nothing to type. They *can* add their UPI reference, which makes matching exact
and enables the duplicate-payment check, but it is optional.

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
pending_payment ───"I have paid"───> awaiting_confirmation
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
- **other orders awaiting confirmation for the same amount** — without a
  reference these are hard to tell apart in a UPI app, so match on the order
  number in the payment note
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

## Material requests

Students ask for a chapter they need; you triage it in **Admin → Requests**.

```
requests/{id}  { email, name, subject, chapter, details, status,
                 adminNote, materialId, createdAt, updatedAt }

open ──plan──> planned ──mark ready──> fulfilled
  │                                        └─ links the material, so the
  ├──decline──> declined                      student gets a direct link
  └──(student)──> withdrawn
```

Requests are **private to their author and you** — the same rule shape as
orders. Making them public would expose every student's email and what they're
stuck on to everyone else.

The **Request queue** groups live requests by chapter, so the same topic asked
by four students is one job rather than four rows. Ordered by how many asked,
then oldest first, so a single request still gets made — it just queues behind
something several people want, and nothing sinks by being old.

A student may hold **5 open requests** at a time (`MAX_OPEN_PER_STUDENT`), which
keeps one enthusiastic person from flooding the queue. Firestore rules also cap
field lengths, so the limits hold even if the page is bypassed.

## Links inside a material

Materials are served to the viewer from a **blob: URL**, not `srcdoc`. This
matters: a `srcdoc` iframe has no base URL of its own, so a link like
`href="#section"` resolves against the *parent* page and the iframe navigates
to a nested copy of the viewer — the material vanishes. A blob URL is a real
document address, so in-page anchors and `location.href = '#id'` behave the way
the material's author intended.

A small guard script is injected into every material to handle the rest:

| Link in a material | What happens |
|---|---|
| `#section` | Scrolls within the material |
| `https://…` | Opens in a new tab; the material stays put |
| `material:<id>` | Opens that material as its own page |
| `viewer.html?id=<id>` | Same — treated as a jump to that material |
| `chapter2.html` | Blocked, with a note saying it isn't part of this material |

**To link one material to another**, use the material's Firestore document id:

```html
<a href="material:AbC123xyz">Next chapter →</a>
```

Ids are visible in the admin materials list. Nothing else resolves — a material
is a single uploaded file, so relative paths to other files have nowhere to go.

## SEO

Only the landing page is public; every other page needs a signed-in account, so
a crawler reaching one sees a loading spinner. Those pages carry
`<meta name="robots" content="noindex">` and are listed in `robots.txt`, and
they are deliberately kept out of `sitemap.xml` — submitting a page Google can
never render adds a thin result, not traffic.

`robots.txt` does **not** block `assets/`. Google renders a page before ranking
it, so blocking CSS and JS makes the site look broken to it.

Link previews (`og:` and `twitter:` tags) are static and absolute because
scrapers do not execute JavaScript, and a relative `og:image` is resolved
inconsistently. `og-image.png` is a 1200x630 card.

**If the site moves to a custom domain, update the URL in four places:**
`robots.txt` (Sitemap line), `sitemap.xml` (`<loc>`), and in `index.html` the
`canonical` link plus the `og:`/`twitter:`/JSON-LD URLs.

The store is currently `noindex` because it requires sign-in. If you ever make
the catalogue publicly browsable, that is the one page worth indexing — remove
its `noindex`, drop it from `robots.txt`, and add it to `sitemap.xml`.

## Free samples

A paid material can carry a free preview so people can see something before
buying. Samples live in their own collection:

```
materialSample/{id}   { htmlContent | jsxContent | pdfContent }
materials/{id}.hasSample   true when one exists
```

`materialSample` is readable by **anyone signed in** — that is the whole point
of a sample — so keep real content out of it. The `hasSample` flag lives on the
metadata so the store can show the right button without downloading every
sample just to find out which exist.

Upload one from **Admin → Study Materials → ＋ Sample** on any material. The
store then shows *View a sample*, which opens `viewer.html?id=<id>&sample=1`.

Without a sample, the store shows *Ask for a sample* instead. That files a
normal request with `kind: 'sample'` and `sampleOf: <materialId>`, so it lands
in the same Admin → Requests queue, badged, with a button that jumps straight
to uploading the sample. The material id is stored as `sampleOf` rather than
`materialId` because the rules forbid a student setting `materialId` — that
field is the admin's answer.

## Navigation

Below 1040px the site uses a **bottom tab bar** (Store, Materials, Request,
Cart, More) rather than a hamburger. A hamburger hides every destination behind
a gesture people have to already know; the bar puts them on screen the way
every app on a phone does. "More" opens the drawer for Orders, Admin and sign
out. Above 1040px the top nav takes over and the bar is hidden.

## Store cover images

Each material can carry a 16:9 picture shown on its store tile.

```
materialCover/{id}      { dataUrl }          ← a 640x360 JPEG
materials/{id}.hasCover true when one exists
```

Upload from **Admin → Study Materials → 🖼 Cover**. Whatever is picked is
**centre-cropped to 16:9 and downscaled to 640x360 JPEG in the browser** before
it is stored, stepping the quality down until it fits under 150 KB — a phone
photo is several MB and the wrong shape, and neither should reach Firestore.

**Covers are deliberately not on `materials/{id}`.** The store lists every
material's metadata on load, so a cover there would download every picture on
every visit. Instead each cover is its own document, fetched only when its tile
comes near the viewport (`IntersectionObserver`, 300px margin) and cached for
the session. A tile always renders a 16:9 box — gradient and icon when there is
no picture — so the grid stays level and adding a cover later doesn't reflow
the page.

> If the catalogue ever grows past a few hundred materials, or covers need to
> be bigger, move them to Firebase Storage: CDN-served and browser-cached,
> with no Firestore read per view. At this size the extra subsystem isn't
> worth it.

## A note on "no download"

The viewer disables right-click and the usual save shortcuts, and PDFs are
painted to `<canvas>` with no text layer or browser PDF toolbar. That deters
casual copying — it is not DRM. Anything a browser can display can be
recovered by a determined user. The protection that actually matters is the
Firestore rules, which stop people reading material they were never granted.
