# Tilco SKU Generator

A microsite that builds SKU codes from the Tilco naming convention (final, 23 Sep 2026), works out the version number from the SKU Log, and keeps the registries and log in one shared database.

- **Hosting:** Netlify, deployed from GitHub
- **Database and sign-in:** Supabase. `@tilcotrading.com` emails get in automatically; anyone else (e.g. Gmail) must be added in the **Team** tab. The database enforces this.
- **No build step:** plain HTML, CSS and JavaScript

Open `index.html` with no keys in `config.js` and it runs in **demo mode** (data from the Excel, nothing saved).

## What's in here

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/app.js` | The site: Generate, Decode, SKU Log, Legacy, Registry and Rules tabs |
| `js/sku.js` | The SKU rules engine (build, parse, version). All the convention logic lives here. |
| `js/seed.js` | Starting data transcribed from the Excel |
| `js/store.js` | Data layer: Supabase, or in-memory demo |
| `config.js` | Your Supabase URL and anon key |
| `supabase/setup.sql` | One-time database setup: tables, security and seed data |
| `tests/sku.test.mjs` | 62 tests, including every worked example from the convention. Netlify runs them on each deploy, and a failing test blocks the deploy. |

## Go live

### 1. Supabase (about 10 min)
1. Create a free project at supabase.com. Pick a region close to you, e.g. Mumbai.
2. Open **SQL Editor**, paste in the whole of `supabase/setup.sql` and click **Run**.
3. In **Authentication → URL Configuration**, set **Site URL** to your Netlify URL (you'll get it in step 3; you can come back to this).
4. In **Project Settings → API**, copy the **Project URL** and the **anon public** key into `config.js`.

The anon key is meant to be public. The database itself refuses anyone who isn't signed in with an @tilcotrading.com email or listed under Team access.

**Already ran `setup.sql` before the Team access list existed?** Run `supabase/002_team_access.sql` once in the SQL Editor too.

### 2. GitHub
```bash
cd sku-generator
git init
git add .
git commit -m "Tilco SKU generator"
git branch -M main
git remote add origin https://github.com/<your-org>/tilco-sku-generator.git   # create an empty private repo first
git push -u origin main
```

### 3. Netlify
1. Go to **Add new site → Import an existing project → GitHub**, and pick the repo.
2. Leave the build settings as they are, because `netlify.toml` handles them (publish `.`; the build runs the tests).
3. Deploy, then copy the site URL back into Supabase's **Site URL** (step 1.3).

From then on, every `git push` to `main` redeploys automatically.

### 4. First use
1. Sign in with your work email. You'll get a magic link, so there's no password to manage.
2. In the **Team** tab, add the email of anyone who doesn't have a @tilcotrading.com address. They can sign in straight after.
3. Go to **Registry** and set product codes to CONFIRMED as Tilen signs them off. SKUs can't be registered while their code is PROPOSED.
4. Add the older SKUs to the **SKU Log** or **Legacy** tab, so version numbers continue from the right place.

## Rules decided on 4 Nov 2026 (beyond the Excel)
- **Marketplace suffixes:** a SKU opened for one marketplace only ends with `-CA`, `-UK`, `-EU`, `-JP` or `-WM` (Walmart), and each suffix keeps its own version count: `TC-PMS-JP`, then `TC-PMS-V2-JP`. No suffix = US or shared across marketplaces.
- **Legacy SKUs** from the stock file are loaded once with `003_legacy_import.sql`, which is kept outside this repo because it contains internal product data.
- **PROPOSED product codes:** you can preview the SKU with a warning, but registering it is blocked. The database enforces this too.
- **`TC-01LURN-P1-V11`:** it's live on Amazon, so it stays as a known exception. P1 counts as a single for versioning, so the next single 1 L urinal is `TC-01LURN-V12`.
- **`TPC` (Toothpaste caps):** added to the registry under TC.
- **Ambiguous codes like `12GS`:** these read as "12 oz + GS" or "12 g + S", and the registry's unit for each product decides which. New product codes starting with L, M, G or C get a warning.

## Housekeeping
- **Changing the rules engine:** edit `js/sku.js`, then run `node tests/sku.test.mjs` before you push.
- **Rebuilding the setup SQL:** run `node scripts/make-setup-sql.mjs` after editing `js/seed.js`. You only need this for a fresh database; for a live one, use the Registry tab instead.
- **Nothing can be deleted** (rule 12). Retire SKUs and discontinue codes instead.
- **Who can get in:** anyone can request a sign-in link, but only @tilcotrading.com and Team-listed emails see any data. To stop strangers even creating an account, go to **Authentication → Providers → Email** in Supabase, turn off "Allow new users to sign up", and invite people from **Authentication → Users**.
- **Typos in `config.js`:** the site shows a red error instead of loading. Press F12 and check the Console for the line.
