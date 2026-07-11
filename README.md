# The Coast Ledger — Coast FIRE Planner

Use the calculator here: https://xavier-triplett.github.io/Financial-Calculator/

A zero-build, static retirement planner modeling the **three-bucket Coast FIRE strategy**:
Tax-Deferred (401k/IRA), Tax-Free (Roth), and After-Tax (brokerage), with a
"bridge" from early retirement to the standard penalty-free access age.
Presented as a private-wealth statement — ruled tables, serif verdicts, and an
underwriter's stamp that reads SECURE or DEPLETED at a glance.

## The model

- Saving phases: split each saved dollar across buckets, staged by age
- Savings-rate ramp with an annual increase and cap
- Drawdown strategy: per-bucket withdrawal split for the bridge years and the standard years,
  with automatic equal-split rescue when a preferred bucket runs dry
- Employer 401k match (rate + salary cap) and IRS contribution limits
  (401k / IRA, inflation-indexed, with age-50 catch-up; overflow spills into the brokerage)
- Withdrawal tax modeling: effective income-tax rate on deferred draws,
  capital-gains rate on brokerage draws, Roth tax-free
- Monte Carlo simulation: seeded, reproducible randomized-return runs with a
  survival probability and a 10th–90th percentile net-worth corridor

Plans persist in `localStorage`. Saved data carries no compatibility guarantees —
if the format changes, old saves are simply discarded and the plan starts from defaults.

## The trackers

Alongside the planner sit two independent trackers — actuals to the planner's
assumptions — switched from the top nav:

- **Net Worth (The Observatory)** — net worth only, no transactions. The
  headline chart plots net worth against the **PAW / AAW / UAW** accumulator
  benchmarks (AAW = income × age ÷ (50 − age); PAW = 2×; UAW = ½×), driven by
  recorded per-month age & income or a birth-month + income profile.
  Composition gets its own chart, and every month's balances are edited by
  hand in a ruled accounts × months grid (Cash / Tax-Free / Tax-Deferred /
  After-Tax / Property / Vehicles / Liabilities). No CSV import here.
- **Cashbook** — monthly budgeting only, blind to net worth. One month per
  page: an income / fixed / variable / spending statement with a SURPLUS or
  DEFICIT stamp, and the raw transaction register. Months can be opened by
  hand and transactions added, edited, or deleted inline. **Rocket Money CSV
  import lives here exclusively**: export from Rocket Money (Transactions →
  Export; the file arrives by email) and drop it on the Import button —
  re-imports dedupe, "Ignored From" rows are skipped, and either sign
  convention is normalized. Rocket Money has no public API, so CSV is the
  supported path.

**Plan bridge**: each tracker pushes only its own domain into the planner —
the Net Worth tab carries bucket balances (and shows FI progress); the
Cashbook carries trailing income, expenses, and the observed savings rate.

**Blank slate + seed**: both tabs start empty. Copy `seed.example.js` to
`seed.js` (git-ignored — it holds real financial data) and a "Seed from
config" button appears to load accounts, balance history, age/income
benchmarks, and starting transactions in one click.

Tracker data persists in `localStorage` under its own key, with the same
no-compatibility-guarantees rule as plans.

## Running locally

No build step. Open `index.html` directly, or serve the folder:

```
python -m http.server 8000
```

Cloud sign-in (below) needs an `http(s)://` origin, so use the served URL
rather than opening the file directly when testing it.

## Cloud sync (optional Google sign-in)

Signed out, the app is exactly as before — everything lives in `localStorage`
on the one device. Signing in with Google saves the whole state (plan +
tracker) to Firestore so it survives a cache clear and follows you across
devices.

- **Identity:** Firebase Authentication with Google — the app never sees or
  stores a password.
- **Storage:** one document per user at `/users/{uid}` holding the app state,
  encrypted at rest and in transit by Google.
- **Isolation:** `firestore.rules` lets a signed-in user read/write only their
  own document; everything else is denied.
- **Model:** on sign-in, an existing account document is the source of truth
  and is adopted locally; a first sign-in seeds the account from local data.
  While signed in, edits are debounced and pushed up. `localStorage` remains
  the offline cache underneath.

The Firebase web config in `js/firebase-config.js` is **not a secret** — it
only names the project; access is governed by Auth + the Security Rules. It is
safe to commit and serve publicly. The SDK is vendored in `js/vendor/` so the
app still loads offline (sync simply resumes when back online). If the config
or SDK is absent, the cloud layer disables itself and the app runs local-only.

### One-time Firebase project setup

1. In the [Firebase console](https://console.firebase.google.com), enable
   **Authentication → Google**, and create a **Firestore** database.
2. Deploy the rules in `firestore.rules` (paste them into the console's
   Firestore **Rules** tab, or run `firebase deploy --only firestore:rules`).
   Do this even if you started Firestore in "test mode" — test mode allows
   anyone to read/write and expires after 30 days.
3. Under **Authentication → Settings → Authorized domains**, add your host
   (`localhost` is added automatically; add `xavier-triplett.github.io` for the
   published site).

## Tests

- `node tests/engine.test.js` — engine unit tests, including dollar-exact parity
  with the original app's algorithm when the newer features are neutralized
- `node tests/tracker.test.js` — tracker core: net-worth series, cashflow
  grouping, savings metrics, Rocket Money CSV parsing edge cases
- `tests/smoke.html` — full UI smoke test in a real browser (open it, read the verdict at the top), e.g.:

  ```
  chrome --headless=new --dump-dom --virtual-time-budget=12000 tests/smoke.html | grep -A 30 smoke-result
  ```
- `tests/firebase-load.test.html` — confirms the vendored Firebase SDK and the
  real config initialize in a browser (`FBLOAD PASS`).
- `tests/cloud.test.html` — drives the sign-in → seed / adopt / debounced-push
  sync flow against an in-memory mock Firebase (`CLOUD PASS`).

## Layout

```
index.html                    shell page
favicon.svg                   the stamp, as an icon
seed.example.js               seed config template (copy to git-ignored seed.js)
js/engine.js                  pure calculation core (browser + Node)
js/store.js                   plan state + localStorage persistence
js/schema.js                  input field definitions
js/forms.js                   form builders (field groups, phases, drawdown)
js/app.js                     boot + tab switching + recompute-on-change
js/cloud.js                   optional Google sign-in + Firestore sync (guarded)
js/firebase-config.js         Firebase web config (public by design)
firestore.rules               per-user Firestore Security Rules
js/vendor/                    vendored Chart.js, Flatpickr, Firebase compat SDK
js/tracker/engine.js          tracker calculation core + benchmarks (browser + Node)
js/tracker/rocketmoney.js     Rocket Money CSV parser (browser + Node)
js/tracker/store.js           tracker state + persistence + seeding
js/tracker/kit.js             shared tracker widgets: plan bridge, import, chart theme
js/ui/ledger.js               the planner interface
js/ui/tracker-observatory.js  Net Worth tab — benchmarks, composition, editable grid
js/ui/tracker-cashbook.js     Cashbook tab — monthly budgeting journal
css/                          base + ledger + tracker stylesheets
tests/                        unit tests + browser smoke test
```
