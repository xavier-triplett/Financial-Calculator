# The Coast Ledger — Coast FIRE Planner

**Use it here: https://xavier-triplett.github.io/Financial-Calculator/**

The Coast Ledger projects Traditional retirement, Coast FIRE, and Early FIRE paths
through age 95. It tracks tax-deferred, Roth, and brokerage balances separately and
shows when a plan reaches its coast milestone, whether an early-retirement bridge is
secure, and how the full retirement holds up.

This is a planning model, not financial advice. Taxes, account rules, returns, and
personal circumstances are simplified assumptions that you should review before relying
on an output.

## Getting started

1. In **Profile**, choose a retirement path and enter your date of birth, gross income,
   annual expenses, and milestone ages. Coast FIRE stops new retirement contributions at
   the coast age while modeled employment continues until full retirement. The
   account-access age defaults to 60; switch to **Expert** to change it.
2. In **Planner**, review your savings rate, account balances, allocation, employer
   match, market return, inflation, and drawdown strategy.
   The default match assumes an employer contributes 50% of eligible workplace-plan
   contributions up to 6% of salary; set the match rate to zero if that is not yours.
3. Read the four headline results:

   - **Path milestones:** adaptive verdicts for reaching and sustaining Coast FIRE,
     reaching a traditional retirement, or funding the Early FIRE bridge.
   - **Resilience:** the share of randomized market paths that retain money through age
     95.
   - **Coast number:** the after-tax retirement balance needed today for growth alone to
   reach the full retirement target at the later of retirement or account access. The progress comparison
     uses Roth assets plus tax-adjusted tax-deferred assets; brokerage and cash are not
     part of this particular measure.
4. Adjust the inputs and watch the projection update immediately.

Use **Beginner** mode for the essential inputs and results. **Expert** mode exposes tax,
contribution-limit, allocation, drawdown, and simulation controls. Both modes use the
same saved plan and calculation engine; settings hidden in Beginner mode remain active.
The in-app **Guide** explains Coast FIRE, the account buckets, and every result in plain
language.

## Tracking reality

Two tracker tabs compare the plan with actual results:

- **Net Worth** records monthly account balances and can send the latest bucket balances
  to the Planner. Expert mode also compares net worth with the PAW, AAW, and UAW
  accumulation benchmarks.
- **Cashbook** records monthly income and spending. Transactions can be entered by hand
  or imported from a Rocket Money CSV. Re-imports are deduplicated, ignored rows are
  skipped, sign conventions are normalized when they are unambiguous, and custom CSV
  column names can be configured in the Expert-only **Categories** tab. Cashbook can send
  trailing expenses to the Planner. With positive income and at least three months of
  history, it can also send trailing income and the observed savings rate; transaction
  income is treated as take-home pay and grossed up using the Profile tax rate.

The trackers remain separate: Net Worth does not infer balances from transactions, and
Cashbook does not edit net-worth history.

## Your data

Plan and tracker data are saved in the browser with `localStorage`. No account is
required, and no data is uploaded while signed out. On the hosted HTTPS site, a service
worker caches the application after a successful visit so the signed-out planner and
trackers can continue to load offline.

Google sign-in is optional. When enabled, plan and tracker changes sync to a private
Firestore user tree. Sync is revision-checked: if another device changed the same data,
the app stops and asks whether to keep the cloud copy or the local copy instead of
silently overwriting either one. Pending changes retry after temporary failures.

A valid older single-document cloud save is upgraded atomically the first time its owner
signs in with the current app, preserving its plan and tracker data. After that upgrade,
an older copy of the app can keep working locally but cannot sync; reload it before making
more changes. Saved formats otherwise have no compatibility guarantee, and a future schema
change may discard old local or cloud data rather than migrate it.

## For developers

Setup, architecture, model details, cloud configuration, and the test suite are in
[TECHNICAL.md](TECHNICAL.md). Notices for bundled dependencies and fonts are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
