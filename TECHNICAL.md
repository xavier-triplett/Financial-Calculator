# The Coast Ledger — Technical Details

For product usage, see the [README](README.md) or the in-app **Guide**.

Live site: https://xavier-triplett.github.io/Financial-Calculator/

The Coast Ledger is a zero-build static web application. The production path uses plain
HTML, CSS, and browser JavaScript; Node dependencies exist only for tests and Firebase
tooling. Calculation and tracker modules attach small APIs to `globalThis`, which lets the
same source files run in a browser and in Node tests.

## Retirement model

`js/engine.js` is the pure calculation core. It normalizes all inputs before simulating
one row per age from the current age through 95.

### Working years

The plan type is Traditional retirement, Coast FIRE, or Early FIRE. Traditional and
Early FIRE continue normal contributions until `retireAge`. Coast FIRE contributes only
before `coastAge`; from `coastAge` through `retireAge`, income and expenses continue but
employee contributions and employer match are zero.

- A starting savings rate can increase each year up to its configured cap.
- Requested saving is capped at the money actually available after the effective income
  tax and current expenses. The result records the savings rate used and flags the first
  age at which the requested plan was infeasible.
- Saving phases split contributions among tax-deferred, Roth, and brokerage buckets. A
  phase begins at its stated age, and normalized phase percentages always total 100%.
- Traditional and Roth workplace contributions share the workplace-plan limit, then
  traditional and Roth IRA contributions share the IRA limit. Tax-advantaged overflow is
  redirected to brokerage.
- The 2026 workplace and IRA limits are indexed with the model's inflation assumption.
  The model applies the regular age-50 catch-ups and the larger workplace-plan catch-up
  for ages 60–63.
- Employer match is based on both traditional and Roth workplace contributions, capped
  by a percentage of salary, and deposited in the tax-deferred bucket.

Income grows by the configured income-growth rate and expenses grow with inflation.
Invested buckets receive the fixed or sampled market return. Cash counts in net worth but
does not grow and is never used for simulated withdrawals.

### Retirement years

The early-retirement bridge begins at `retireAge`; the standard phase begins at
`standardRetireAge`. Each phase has a preferred withdrawal split across brokerage,
tax-deferred, and Roth assets. If a preferred bucket cannot supply its share, the model
reallocates the shortfall across buckets that still hold money.

Withdrawal rates are effective simplifications:

- Brokerage tax is applied to the whole brokerage withdrawal, not only its gain.
- Tax-deferred withdrawals are grossed up for the configured effective tax rate.
- Before the standard access age, tax-deferred withdrawals also pay the configured early
  penalty.
- Roth draws are modeled as tax- and penalty-free contribution withdrawals.

The bridge fails when brokerage is exhausted during the bridge and retirement assets are
needed to fill the shortfall. The full plan fails when the investable portfolio cannot
meet spending. Inert cash can keep reported net worth above zero, but it cannot rescue an
exhausted portfolio.

### FI and Coast measures

The FI target is annual spending divided by the safe-withdrawal rate. The Coast number
inflates current spending to the later of retirement or account access, calculates the
FI target at that age, and discounts it back to today using the configured market return.

For a Coast FIRE plan, the engine also records the projected tax-adjusted retirement
balance when contributions stop, the Coast target at that age, and percentage coverage.
Traditional retirement readiness compares the full after-tax investable portfolio with
the FI target; the Coast measure continues to exclude brokerage and cash by design.

The headline Coast-number progress comparison uses today's Roth balance plus today's
tax-deferred balance reduced by the configured deferred-withdrawal tax rate. Brokerage
and cash are intentionally excluded. Retirement-readiness snapshots are taken before the
first retirement cash flow at the relevant age.

### Monte Carlo

Monte Carlo runs 50–2,000 lean simulations with seeded, reproducible random returns. It
samples lognormal gross returns calibrated so their **arithmetic mean** and arithmetic
standard deviation equal the configured market-return and volatility assumptions. The
typical compounded path can therefore be lower than the arithmetic mean.

The result includes survival through age 95, 10th/25th/50th/75th/90th percentile
net-worth paths, and 10th/50th/90th percentile ending balances. Re-roll changes the seed;
otherwise an unchanged plan produces unchanged results.

## State and validation

`js/store.js` owns plan state under `fireData_v3`. `js/tracker/store.js` owns tracker state
under `trackerData_v2`. Both use `localStorage`, validate data at load/replace boundaries,
and notify subscribers after a successful in-memory update. The tracker surfaces a
warning if persistence fails so an in-memory edit is not mistaken for a durable save.

Input numbers are clamped to engine limits, integer-only values are rounded, drawdown and
saving splits are normalized, duplicate or invalid phases are repaired, and malformed
stored tracker records are discarded field by field. Stored formats have no migration or
backward-compatibility promise; incompatible data may reset to defaults.

Beginner and Expert are presentation modes over this same state. Hidden Expert settings
remain active, and switching modes does not rewrite the plan.

## Trackers

The tracker domains are intentionally independent:

- **Net Worth** stores accounts, monthly balance snapshots, and optional age/income
  history. It calculates assets, liabilities, investable assets, account composition, and
  PAW/AAW/UAW benchmarks (`AAW = age × income ÷ 10`, `PAW = 2 × AAW`,
  `UAW = AAW ÷ 2`). Its bridge to the Planner sends only the latest mapped account
  balances.
- **Cashbook** stores transactions and explicitly opened months. Categories resolve to
  income, transfer, saving, fixed, variable, or spending, with user overrides. Its bridge
  always proposes trailing annual expenses. With positive income and at least three
  months of history, it also proposes a savings rate and estimates gross income by
  treating transaction income as take-home pay and applying the Profile's effective
  income-tax rate.

Trailing Cashbook figures use a contiguous calendar window ending in the latest covered
month, including empty covered months instead of annualizing only active months. In each
month, explicitly marked saving is used when present; otherwise income minus expenses is
used. This supports histories that mix marked and inferred saving without dropping either
kind.

Rocket Money import accepts quoted CSV fields, validates dates and amounts, skips rows
marked ignored, supports custom header mappings, and reports rejected rows. It only flips
a debit-negative expense convention when the income/expense evidence is unambiguous;
ambiguous expense signs are preserved, while income is always normalized positive.
Import identity is occurrence-aware, so exact duplicate purchases in one source file are
retained while re-importing that file remains idempotent.

## Cloud sync

Cloud sync is optional. Signed-out operation remains local-only. Firebase Authentication
uses Google sign-in, and Firestore stores each user's data below `/users/{uid}`:

```text
/users/{uid}                         schema-v2 manifest
/users/{uid}/state/plan              plan payload and revision
/users/{uid}/state/tracker           tracker metadata, digest, chunk count, revision
/users/{uid}/trackerChunks/cNNNN     ordered tracker JSON chunks
```

Plan and tracker revisions advance independently in Firestore transactions. Tracker JSON
uses one to nine ordered UTF-8 chunks of at most 700,000 bytes each. Every tracker revision
writes its metadata and all declared chunks atomically; obsolete trailing chunks are
deleted only as part of the same revision advance. The client validates exact document
shapes, chunk order/count, size limits, and a digest before adopting remote tracker data.

Fresh schema-v2 account creation and legacy migration write the manifest, both state
documents, and every declared tracker chunk in one atomic operation. The rules reject
orphaned state, partial account creation, and any tracker revision with a missing chunk.

`firestore.rules` requires authentication, restricts every read and write to the matching
UID, enforces schema v2 and monotonically increasing revisions, validates timestamps and
field shapes, and rejects unrecognized paths. Rule tests exercise these invariants in the
Firestore emulator.

The client keeps per-user sync revision/hash metadata in `localStorage`. Changes are
debounced, dirty state survives reloads, and temporary failures retry with bounded
backoff. A remote revision mismatch becomes an explicit conflict; the user must choose
the current cloud copy or the current local copy. The app does not use silent
last-writer-wins conflict resolution.

On a new cloud account, non-empty local data is uploaded only after confirmation. On an
existing account, unchanged local state adopts the cloud data. Invalid or incomplete
cloud state is never applied locally.

A valid schema-v1 root document is migrated lazily when its owner first signs in with the
schema-v2 client. One transaction validates the old document, replaces it with the v2
manifest, writes both revision-1 state documents and all tracker chunks, and then loads the
preserved data without a new-account upload prompt. Missing legacy category and CSV maps
are initialized empty. Malformed legacy data or a partial migration is rejected without
changing either copy.

Transition rules let schema-v1 clients continue reading and writing a valid legacy root
until that account migrates. After migration, the rules reject a downgrade: an old client
can still save locally, but it does not load or update the v2 cloud state and must be
refreshed to the current release.

Anonymous and signed-in local snapshots are isolated under separate keys. Account
switches restore only the destination account's snapshot, and sign-out restores the
anonymous snapshot. If unsynced account data cannot be preserved locally, the switch or
sign-out is stopped instead of discarding it.

The public Firebase configuration in `js/firebase-config.js` identifies the project; it
is not a credential. Authentication and Security Rules enforce access. The compat SDK is
vendored under `js/vendor/` and loaded lazily during browser idle time or immediately when
sign-in begins. If configuration or SDK loading is unavailable, the application remains
local-only.

### Firebase setup

1. In the [Firebase console](https://console.firebase.google.com), enable Google under
   **Authentication** and create a Firestore database.
2. Add each deployed host under **Authentication → Settings → Authorized domains**.
   Add `127.0.0.1` as well if local sign-in will use the loopback command below.
3. Deploy the repository rules:

   ```powershell
   npx firebase deploy --only firestore:rules
   ```

Never leave the database in Firestore test mode.

### Cloud-schema release order

Cloud schema releases use this order:

1. Run `npm test` against the client and matching rules.
2. Deploy and verify `firestore.rules`.
3. Publish the client, then smoke-test sign-in against production.

Rules must land first so the new client can write its document tree. The transition rules
keep unmigrated old clients working during this interval. GitHub Actions tests and deploys
the static Pages site only; it does not deploy Firestore rules.

## Offline and browser security

All fonts and signed-out core runtime libraries are vendored. Google sign-in additionally
loads its resolver from `apis.google.com`. On HTTPS, `sw.js` installs a versioned cache
containing the application shell and core assets. Same-origin requests go to the network
first so a deployment is not pinned behind stale cached code, then fall back to the cache
offline. Successful responses refresh the cache. Service workers register on HTTPS and
loopback development origins, but not on `file:` or arbitrary plain-HTTP origins.

`index.html` applies a restrictive Content Security Policy and referrer policy. Scripts
are external, the Firebase network allowlist is explicit, object embedding is disabled,
and the small early security script synchronously hides framed rendering.

The UI uses labeled controls, keyboard-operable disclosure buttons and hints, visible
focus states, text summaries for canvas charts, and a modal that traps focus while open
and restores it on close. These are implementation safeguards, not a claim of formal
accessibility certification.

## Running locally

The application has no production build step. Open `index.html` directly for local-only
use, or serve the repository on loopback:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000/`. Firebase sign-in requires an authorized `http(s)://`
origin, so it is unavailable from `file:`. The service worker registers on this trusted
loopback origin to support local testing as well as on production HTTPS.

## Tests and CI

Install test tooling with `npm ci`. The complete suite requires Node, Chrome/Chromium,
and Java for the Firestore emulator:

```powershell
npm test
```

The scripts can also run separately:

- `npm run test:unit` checks syntax plus engine, plan-store, and tracker behavior.
- `npm run test:browser` runs the UI smoke suite, mocked cloud lifecycle suite, and
  vendored Firebase/config load check in isolated headless-Chrome profiles. It also
  serves and boots the production `index.html` over a loopback HTTP server and fails on
  missing required assets. A secure-context browser test installs the service worker,
  removes a stale release cache, verifies network-first behavior, and loads the cached
  application shell with the server offline. Fixture pages use in-memory storage and
  disable themselves outside local or `file:` origins.
- `npm run test:rules` runs authenticated-isolation, atomic account creation/migration,
  revision, all-chunk, size-limit, and cleanup tests against the Firestore emulator.

GitHub Actions runs verification for pushes and pull requests. A successful push to
`main` builds the static site with GitHub Pages and deploys it after tests pass. Firestore
rules remain the separate manual release step described above.

## Repository layout

```text
index.html                         application shell and security policy
sw.js                              offline application cache
favicon.svg                        site icon
js/engine.js                       retirement calculation and Monte Carlo
js/store.js                        normalized plan state and persistence
js/schema.js                       input and disclosure definitions
js/forms.js                        reusable form and phase editors
js/app.js                          boot, navigation, modal, recomputation, sync status
js/security.js                     early framed-page guard
js/cloud.js                        revision-safe optional cloud sync
js/firebase-config.js              public Firebase project configuration
js/firebase-loader.js              lazy vendored Firebase SDK loader
js/tracker/engine.js               tracker calculations and benchmarks
js/tracker/rocketmoney.js          CSV parser and import normalization
js/tracker/store.js                validated tracker state and persistence
js/tracker/kit.js                  tracker charts, import, and Planner bridge helpers
js/ui/                             Profile, Planner, trackers, Categories, and Guide
js/vendor/                         Chart.js, Flatpickr, Firebase compat bundles
css/                               application styles and vendored fonts
firestore.rules                    per-user schema and concurrency enforcement
firebase.json, .firebaserc         Firebase emulator/deploy configuration
tests/                             Node, browser, cloud, and Firestore rules tests
.github/workflows/ci.yml           verification and GitHub Pages deployment
package.json                       test scripts and development dependencies
THIRD_PARTY_NOTICES.md             bundled dependency and font notices
```
