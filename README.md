# The Coast Ledger — Coast FIRE Planner

**Use it here: https://xavier-triplett.github.io/Financial-Calculator/**

The Coast Ledger projects a retirement plan through working years, an early-retirement
bridge, and retirement through age 95. It tracks tax-deferred, Roth, and brokerage
balances separately and shows whether the bridge is secure, retirement is fully or
partially funded, or the portfolio is depleted.

This is a planning model, not financial advice. Taxes, account rules, returns, and
personal circumstances are simplified assumptions that you should review before relying
on an output.

## Getting started

1. In **Profile**, enter your date of birth, gross income, annual expenses, and early
   retirement age. The account-access age defaults to 60; switch to **Expert** to change
   it or review tax and contribution-limit assumptions.
2. In **Planner**, review your savings rate, account balances, allocation, employer
   match, market return, inflation, and drawdown strategy.
   The default match assumes an employer contributes 50% of eligible workplace-plan
   contributions up to 6% of salary; set the match rate to zero if that is not yours.
3. Read the four headline results:

   - **Goal I — The Bridge:** whether brokerage can cover the years between early
     retirement and the account-access age without needing retirement assets to fill a
     shortfall.
   - **Goal II — The Coast:** whether the retirement accounts can support spending once
     they become available.
   - **Resilience:** the share of randomized market paths that retain money through age
     95.
   - **Coast number:** the after-tax retirement balance needed today for growth alone to
     reach the full retirement target at the account-access age. The progress comparison
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

Saved formats have no compatibility guarantee. This is a greenfield project, so a future
schema change may discard old local or cloud data rather than migrate it.

## For developers

Setup, architecture, model details, cloud configuration, and the test suite are in
[TECHNICAL.md](TECHNICAL.md). Notices for bundled dependencies and fonts are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
