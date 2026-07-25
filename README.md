# Meridian: FIRE Planner

**Use it here: https://xavier-triplett.github.io/Financial-Calculator/**

Meridian projects Traditional retirement, Coast FIRE, and Early FIRE paths
through age 95. It tracks tax-deferred, Roth, and brokerage balances separately and
shows when a plan reaches its coast milestone, whether an early-retirement bridge is
secure, and how the full retirement holds up.

This is a planning model, not financial advice. Taxes, account rules, returns, and
personal circumstances are simplified assumptions that you should review before relying
on an output.

## Getting started

1. Start on **Today**. The app withholds every readiness verdict until it has a date of
   birth, annual spending, and income while the user is still working.
2. In **Profile**, choose a retirement path and enter your date of birth, gross income,
   annual expenses, and milestone ages. Coast FIRE stops new retirement contributions at
   the coast age while modeled employment continues until full retirement. The
   account-access age is fixed at 60 in Beginner mode; switch to **Expert** to change it.
3. In **Planner**, review your savings rate, account balances, allocation, employer
   match, market return, inflation, and drawdown strategy.
   The default match assumes an employer contributes 50% of eligible workplace-plan
   contributions up to 6% of salary; set the match rate to zero if that is not yours.
4. Read the four headline results:

   - **Path milestones:** adaptive verdicts for reaching and sustaining Coast FIRE,
     reaching a traditional retirement, or funding the Early FIRE bridge.
   - **Resilience:** the share of randomized market paths that retain money through age
     95.
   - **Coast number:** the spendable retirement balance needed today for growth alone to
     reach the full retirement target at the later of retirement or account access. The progress comparison
     uses Roth assets plus tax-adjusted tax-deferred and brokerage assets. Cash remains
     outside the invested comparison.
5. Adjust the inputs and watch the projection update immediately.

**Beginner** and **Expert** are two different simulations, not one simulation at two levels
of detail. Beginner runs a fixed model that is the same for every plan and printed in full
on the Profile tab: one savings rate that never ramps, growth after inflation, standard
rates and contribution limits, and the 4% withdrawal rule. **Beginner does not invent a
tax estimate:** income tax, withdrawal tax, brokerage tax, and early-withdrawal penalties
all start at zero and are stated that way. Because inflation is removed
rather than modeled, every beginner figure reads in today's dollars. **Expert** exposes
every rate, saving phase, drawdown rule and diagnostic, projected in future dollars.

A value customized in Expert mode never leaks into a beginner run, so the same saved plan
reports different numbers in the two modes. Both read and write one saved plan; switching
modes never rewrites it.
The in-app **Guide** explains Coast FIRE, the account buckets, and every result in plain
language.

## Tracking reality

The tracker compares the plan with actual results:

- **Net Worth** records monthly or arbitrary dated balance snapshots. Accounts carry an
  institution, currency, source date, and liability terms. The latest balances can be
  reviewed before they are carried into the Planner. Expert mode also compares net worth
  with the PAW, AAW, and UAW accumulation reference lines.
- **Cashbook** records monthly income and spending. Transactions can be entered by hand
  or imported from a transaction CSV, including Rocket Money exports and custom-mapped
  bank columns. Re-imports are deduplicated, ignored rows are skipped, sign conventions
  are normalized when they are unambiguous, and transactions can be split or corrected
  in bulk. Cashbook can send
  trailing expenses to the Planner. With positive income and at least three months of
  history, it can also send trailing income and the observed savings rate; transaction
  income is treated as take-home pay and grossed up using the Profile tax rate.
- **Goals** adds monthly category targets with optional rollover, savings goals, recurring
  transaction reminders, and debt payoff estimates.
- **Rules** teaches future imports how to categorize merchants and supports custom CSV
  column mappings.

The trackers remain separate: Net Worth does not infer balances from transactions, and
Cashbook does not edit net-worth history.

## Your data

Plan and tracker data are saved in the browser with `localStorage`. No account is
required, and no data is uploaded while signed out. On the hosted HTTPS site, a service
worker caches the application after a successful visit so the signed-out planner and
trackers can continue to load offline.

The **Data** tab downloads or restores the complete workspace as readable JSON, shows
when account balances were last refreshed, exposes bounded session undo, and can clear
local data. When signed in, it can delete the synced cloud workspace and the local copy
together. Backup files are intentionally portable and are not encrypted.

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
