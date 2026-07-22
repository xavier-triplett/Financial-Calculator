# The Coast Ledger — Coast FIRE Planner

**Use it here: https://xavier-triplett.github.io/Financial-Calculator/**

The Coast Ledger is a retirement planner built around one question: *if you retire
early, will your money last?* You describe your finances once, and the app projects
them forward — through an early retirement, across the years before you can touch
your retirement accounts, and all the way to 95 — then stamps a verdict on the plan:
**SECURE** or **DEPLETED**.

New to the finance side of this? Open the **Guide** tab inside the app — it explains
Coast FIRE, the three buckets, and every term the app uses, in plain language.

Use **Beginner** mode for the essential inputs and results, or **Expert** mode to
open every tax, contribution, allocation, drawdown, and simulation control. Both
modes use the same saved plan and calculation engine.

## Getting started

1. **Profile tab — enter your baseline.** Date of birth, gross income, annual
   expenses, and your two target ages: the age you want to stop working, and the age
   your retirement accounts unlock (usually 60). Everything else in the app reads
   from these facts.
2. **Planner tab — set your assumptions.** How much of your income you save, where
   those dollars go (401k / Roth / brokerage), your employer match, expected market
   return, and inflation. Sensible defaults are pre-filled — you can leave most of
   them alone at first.
3. **Read the verdicts.** The top of the Planner answers the two questions that
   matter:
   - **Goal I — The Bridge:** can your brokerage carry you from early retirement to
     the age your retirement accounts unlock?
   - **Goal II — The Coast:** once everything unlocks, is there enough to fund the
     rest of your life?
   - **Resilience:** your plan is also re-run against 2,000 randomized market
     futures (booms, crashes, flat decades) — the percentage shown is how many of
     those futures still leave you with money at 95.
   - **Coast number:** the invested balance needed today for growth alone, with no
     new savings, to reach the full retirement target when your accounts unlock.
4. **Adjust and watch.** Every field recalculates the plan instantly. Drag your
   savings rate or retirement age around and watch the stamps flip.

Hover (or tap, on a phone) the small ⓘ icons next to any field for an explanation of
exactly what it does.

## Tracking reality

The plan is only as good as the numbers behind it. Two tracker tabs record what
actually happens:

- **Net Worth** — a month-by-month grid of your account balances (cash, retirement,
  brokerage, property, debts), charted against income-based accumulation benchmarks
  so you can see whether you're ahead of or behind the curve for your age.
- **Cashbook** — one month per page: money in, money out, and a **SURPLUS** or
  **DEFICIT** stamp. You can log transactions by hand or import a Rocket Money CSV
  export directly (a downloadable template shows the expected shape).

The **Categories** tab tunes the bookkeeping: override which kind any category
counts as (income, transfer, fixed, variable, or spending), and point the CSV
importer at your own column headers if your bank's export names them differently.

Each tracker can push its actuals back into the Planner with one click — real
balances and your observed savings rate replace your guesses.

## Your data

Everything you type stays in your browser (`localStorage`) — nothing is uploaded and
there is no account requirement. Optionally, **sign in with Google** to sync your
data to the cloud so it survives a cleared cache and follows you across devices.
Signed out, the app works fully offline.

## For developers

Setup, architecture, the simulation model, cloud configuration, and tests are
documented in [TECHNICAL.md](TECHNICAL.md).
