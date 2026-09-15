# StudyVault

A private library where students sign in with Google and read only the study
materials assigned to them. Static files + Firebase (Auth + Firestore) — no
server to run.

## Pages

| File | Who | What |
|---|---|---|
| `index.html` | public | Landing page + Google sign-in. Signed-in users are redirected on. |
| `library.html` | student / admin | "My Materials" — folders, breadcrumbs, grid. |
| `viewer.html?id=<id>` | student / admin | Secure viewer (HTML, JSX/TSX, PDF). |
| `admin.html` | admin only | Students, access, folders, materials, maintenance. |

Shared code lives in `assets/js/` (`config`, `firebase`, `ui`, `session`,
`content`, `render`) and `assets/css/app.css`.

## Data model

```
students/{email}        { email, name, files: [materialId], addedAt }
folders/{id}            { name, parentId, createdAt }
materials/{id}          { title, tag, folderId, kind, createdAt }      ← metadata
materialContent/{id}    { htmlContent | jsxContent | pdfContent | url } ← the bytes
```

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

## A note on "no download"

The viewer disables right-click and the usual save shortcuts, and PDFs are
painted to `<canvas>` with no text layer or browser PDF toolbar. That deters
casual copying — it is not DRM. Anything a browser can display can be
recovered by a determined user. The protection that actually matters is the
Firestore rules, which stop people reading material they were never granted.
