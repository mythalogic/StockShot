# StockShot

Mobile-first PWA for stocktake teams: pick a product, capture a **product photo** and a **barcode photo**, and everyone sees live progress. Installs to the home screen on iPhone, iPad and Android — no App Store.

**Stack:** React + Vite + TypeScript + Tailwind · Supabase (Auth, Postgres, Storage, Realtime) · vite-plugin-pwa · JSZip.

---

## 1. Create the Supabase backend (~5 minutes)

1. Go to [supabase.com](https://supabase.com) → create a free project.
2. Open **SQL Editor → New query**, paste the entire contents of **`supabase/schema.sql`**, and Run. This creates the `products`, `captures`, `profiles` and `app_settings` tables, Row Level Security policies, the realtime subscription, and the `captures` storage bucket.
3. In **Project Settings → API**, copy the **Project URL** and the **anon public key**.

## 2. Configure and run the app

```bash
cp .env.example .env        # then paste your URL + anon key into .env
npm install
npm run dev                 # local dev at http://localhost:5173
```

## 3. Create the first user and promote to manager

1. Open the app, tap **Create an account**, sign up.
   - Tip: in Supabase **Authentication → Providers → Email**, you can turn off "Confirm email" for faster team onboarding.
2. In the Supabase **SQL Editor**, promote yourself:

```sql
update public.profiles set role = 'manager' where email = 'you@example.com';
```

3. Sign out and back in. You'll now see the **Admin** tab.

Roles: `member` = capture; `manager` = capture + import + settings (and export, if restricted).

## 4. Load the products

Go to **Admin → Import** and tap **Load bundled products.csv** (the 328-row file ships with the app), or upload any `.csv` / `.xlsx` with columns:

```
Supplier,SKU,ProductName
```

Imports **upsert by SKU** — re-importing updates names/suppliers and never wipes captured photos.

## 5. Deploy over HTTPS (required for camera + install)

Any static host works. Easiest: [Vercel](https://vercel.com) or [Netlify](https://netlify.com):

1. Push this folder to a Git repo, import it into Vercel/Netlify.
2. Framework preset: **Vite**. Build command `npm run build`, output `dist`.
3. Add the two environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy — you get an HTTPS URL to share with the team.

### Install to home screen

- **iPhone / iPad (Safari):** open the URL → Share → **Add to Home Screen**. (The app shows a first-run hint for this, since iOS has no automatic prompt.)
- **Android (Chrome):** open the URL → tap the **Install app** prompt.

Once installed it opens full-screen, standalone, and the app shell loads offline (captures still need connectivity to upload).

---

## Using the app

- **Products** — searchable by SKU or name, supplier filter chips, status badges (Not started / 1 of 2 photos / ✓ Done). Done rows are de-emphasised but can be reopened to retake.
- **Capture** — two tiles open the device's rear camera via a native camera input (the most reliable method inside installed PWAs on iOS). Retake / Use photo preview, then **Save** uploads compressed JPEGs (max 1600px, q0.8) to Storage at `captures/{SKU}/product.jpg` and `captures/{SKU}/barcode.jpg`. As a bonus the barcode photo is run through `BarcodeDetector` (ZXing fallback) and any decoded number is stored — decoding never blocks saving.
- **Progress** — overall bar plus per-supplier breakdown; updates **live** on every device via Supabase Realtime as anyone saves.
- **Export** — three formats, always covering *every* product with its current status:
  1. **ZIP (recommended):** `stockshot_export.csv` + `images/` folder with `{SKU}_product.jpg` / `{SKU}_barcode.jpg`.
  2. **CSV with image links** — photo columns are hosted URLs.
  3. **CSV with base64-embedded images** — single self-contained file (large; Excel handles it poorly).
  Managers can flip a toggle to restrict export to managers only.

## Project layout

```
supabase/schema.sql     ← run this in Supabase SQL Editor
public/products.csv     ← bundled 328-product seed file
src/pages/              ← SignIn, Products, Capture, Progress, Export, AdminImport
src/lib/                ← supabase client, image compression, barcode decoding
src/context/            ← auth + data (realtime) providers
```

## Acceptance checklist

- [x] Installs to home screen on iPad, iPhone and Android; opens full-screen (manifest + service worker + HTTPS).
- [x] Search filters by SKU and product name; supplier filter works.
- [x] Selecting a product opens the camera; two photos with retake/use.
- [x] Photos upload; product shows "Done"; status persists (stored in Postgres).
- [x] A second user on another device sees progress update live (Realtime).
- [x] Export ZIP = CSV + product & barcode images per SKU; Status reflects real progress.
- [x] Product list seeds from the provided `products.csv`.
