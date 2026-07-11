/* Optional personal seed for the tracker. Copy to seed.js (git-ignored) and
 * fill with your data; a "Seed from config" button then appears on the empty
 * Net Worth and Cashbook tabs.
 *
 * groups: cash | taxFree | taxDeferred | afterTax | property | vehicle | liability
 * profile: seeds the shared Profile tab — birthMonth becomes your date of
 *   birth (which drives your age) and annualIncome your baseline income.
 * ageIncome: per-month age & annual income, used to draw the PAW / AAW / UAW
 *   benchmark lines (months without an entry fall back to the Profile).
 * txns: optional starting transactions for the Cashbook; Rocket Money CSV
 *   imports merge on top without duplicating. */
window.TrackerSeed = {
    profile: { birthMonth: '1990-01', annualIncome: 100000 },
    accounts: [
        { id: 'a1', name: 'Savings',   group: 'cash' },
        { id: 'a2', name: 'Roth IRA',  group: 'taxFree' },
        { id: 'a3', name: '401k',      group: 'taxDeferred' },
        { id: 'a4', name: 'Brokerage', group: 'afterTax' },
        { id: 'a5', name: 'House',     group: 'property' },
        { id: 'a6', name: 'Mortgage',  group: 'liability' }
    ],
    snapshots: {
        '2026-01': { a1: 10000, a2: 40000, a3: 90000, a4: 15000, a5: 400000, a6: 320000 },
        '2026-02': { a1: 11000, a2: 41000, a3: 92000, a4: 15500, a5: 400000, a6: 319000 }
    },
    ageIncome: {
        '2026-01': { age: 36, income: 100000 }
    },
    txns: [
        { id: 'x1', date: '2026-02-01', name: 'Paycheck', amount: 6000, category: 'Paychecks', account: 'Checking' },
        { id: 'x2', date: '2026-02-03', name: 'Grocery Store', amount: 120.5, category: 'Groceries', account: 'Credit Card' }
    ]
};
