# Beginner / Expert mode

This is the implemented design. It came out of a design study that drafted three
competing approaches (a global mode switch, per-tab progressive disclosure, and
a separate beginner dashboard tab) and judged them against this codebase. The
recommendation below is the winning hybrid: a global mode switch, corrected by
the disclosure design's honesty badge and the dashboard design's first-boot
heuristic.

## Why this shape

The concept inventory found that only seven inputs lack safe defaults: date of
birth, annual gross income, annual expenses, early retirement age, and the
three bucket balances plus the starting savings rate. Exactly one shipped
default is unsafe when left untouched: employer match, which invents
50%-up-to-6% free money for anyone who has no match. Everything else (taxes,
IRS caps, SWR, phases, drawdown order, Monte Carlo dials) refines the answer at
the margins. So a beginner surface can be a lens over the same engine, never a
fork: hidden inputs keep their stored values, and the projection is
bit-identical across the switch.

## Mode state and defaulting

- `pref` in `js/app.js` becomes `{ view, theme, mode }` under the existing
  `uiPref_v3` key. Deliberately not cloud-synced (matches theme).
- Decide a missing mode in `boot()` AFTER `FireStore.init()` and
  `TrackerStore.init()` (`loadPref()` runs before store init, so it cannot
  decide): `pref.mode = (FireStore.isDefault() && TrackerStore.isEmpty()) ?
  'beginner' : 'expert'`. Fresh visitors get beginner; devices with data
  (the maintainer, seed.js users) stay expert and notice nothing. Both
  predicates already exist.
- Stamp `document.documentElement.setAttribute('data-mode', pref.mode)`
  exactly like `applyTheme()` stamps `data-theme`.
- New API: `FireApp.mode()` and `FireApp.setMode(m)`: set pref, save, re-stamp,
  `mountActive()` (nav rebuilds, active tab remounts; `currentEntry()` already
  falls back to tabs[0] if the view vanished, so re-sync `pref.view`), toast.
  Zero store writes on switch.

## Switch UX

- A compact two-button segmented control ("Beginner | Expert") in
  `renderNav()`'s `.nav-right` span (survives the hamburger collapse, so it is
  always reachable on phones). Buttons carry `data-mode-set`, handled in the
  existing nav click delegate.
- Secondary entry points: the beginner assumptions note (below) ends with an
  "Open Expert mode" link, and the Guide gains a short "Two modes" card.

## Tabs per mode

- Beginner: Profile, Planner, Net Worth, Cashbook, Guide.
- Expert adds: Categories. Mechanism: `expertOnly: true` on the
  tracker-settings registration; `allTabs()` filters it in beginner mode.

## Fields and panels per mode

Schema flags (`expert: true` in `js/schema.js`) flow through
`buildGroups`/`buildField` in `js/forms.js` as class `ff-expert`, hidden by one
CSS rule: `html[data-mode="beginner"] .ff-expert { display: none; }`.

- **Profile**: beginner keeps the DOB hero, `retireAge`, `income`, `expenses`.
  Expert-flagged: `standardRetireAge`, `incomeTaxRate`, the whole `taxes` and
  `irs` groups. The `pf-help` copy branches.
- **Planner aside**: beginner keeps `savingsRate`, all four bucket balances
  including `balCash` (the plainest field in the app; hiding it would
  understate net worth), the employer group as a yes/no toggle (below), and
  `marketReturn`. Expert-flagged: `savingsRateIncrease`, `maxSavingsRate`,
  `incomeGrowth`, `inflation`, `swr`, the `montecarlo` group, plus `lg-expert`
  classes on the Saving phases and Drawdown editors.
- **Planner main**: all four verdict cards stay. `lg-expert` on the
  Range-of-outcomes panel, the figures row, the year-by-year table, the
  re-roll button, and the sims/sigma subline. CSS hiding is correct here
  because the ledger keeps a persistent DOM that `update()` mutates.
- **Net Worth** (`tracker-observatory.js`): this file rebuilds
  `els.body.innerHTML` every update, so branch the template strings on
  `FireApp.mode()` instead of CSS (also avoids constructing the benchmark
  chart on a hidden canvas). Beginner omits: the Accumulator KPI (3-column
  KPI variant), the benchmarks panel and chart, the Benchmark profile aside,
  and the grid's income row. Beginner KEEPS the plan-bridge aside (the
  diff-then-apply loop is the reason to come back) and the Composition chart
  stretched full width.
- **Cashbook**: beginner skips the CSV-template button in the masthead only
  (keep it in the empty state). Keep everything else, including import and
  the bridge panel.
- **Guide**: both modes; add a "Two modes" card.

## Employer match, the one unsafe default

In beginner mode the employer group renders as a toggle: "My employer matches
401k contributions", checked iff `employerMatchRate > 0`. Unchecking writes
rate 0; checking restores the default; while checked, the two fields render
beneath. Drive it from a schema-level `beginnerToggle` config on the group so
`forms.js` stays generic. This is the only mode-related data write, and only on
explicit user action.

## Honesty note (the safety valve)

A helper walks the `expert: true` flags plus the drawdown keys and phases, and
counts values that differ from `FireEngine.DEFAULTS`. Rendered at the bottom of
the Planner aside and the Profile card in beginner mode:

- All stock: "Simplified view. Taxes, contribution limits, inflation and the 4%
  withdrawal rule are running on standard assumptions. Open Expert mode to
  change any of them."
- Otherwise: "Simplified view. N settings were customized in Expert mode and
  are still in effect. Open Expert mode." A non-default hidden assumption is
  never invisible.

## Verdict copy

`verdicts()` in `js/app.js` stays the single source of facts; only presentation
strings branch on `FireApp.mode()` inside `ledger.js`. Beginner examples: coast
secure note becomes "Once your accounts unlock at {age}, spending is covered
through 95"; the Resilience eyebrow becomes "Resilience: odds it works"; the FI
card becomes "Your target number / What a full retirement needs"; the wealth
chart note becomes "dashed line marks your target number".

## Implementation order (~300 LOC, ~12 files, no engine/store/cloud changes)

1. `js/app.js` (~45): pref.mode, boot default, data-mode stamp, mode API,
   allTabs filter, nav control.
2. `js/schema.js` (~14): expert flags, beginnerToggle, expertKeys helper.
3. `js/forms.js` (~30): ff-expert emission, toggle rendering.
4. CSS (~35): nav control, ff-expert and lg-expert rules, 3-col KPI variant.
5. `js/ui/ledger.js` (~45): lg-expert classes, copy branches, assumptions note.
6. `js/ui/profile.js` (~12): help branch, assumptions note.
7. `js/ui/tracker-observatory.js` (~20), `tracker-cashbook.js` (~4): template
   branches.
8. `js/ui/tracker-settings.js` (1): expertOnly. `js/ui/guide.js` (~15): card.
9. `tests/smoke.html` (~25): `FireApp.setMode('expert')` before existing
   assertions (they exercise phases, drawdown, mcSims, Categories); a new
   beginner block asserting the Categories tab is absent, expert elements are
   hidden, the employer toggle renders, and the Monte Carlo rate still shows.

## Deferred

The experience-led "Compass" idea (a 5-question first-run setup plus a
one-page "Am I on track?" dashboard) is the right phase 2 if beginner traffic
ever justifies a second verdict surface; `pref.mode` and the tab filter are
exactly the hooks it needs. Until then, one maintained verdict surface wins.
