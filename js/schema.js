/* Input field definitions shared by every UI skin.
 * Each UI renders these groups in its own visual language. */
(function (global) {
    'use strict';

    /* Group icons as inline SVG so every glyph shares one visual language
     * (24-unit grid, 2px round stroke, currentColor) instead of the mixed
     * weights that unicode characters render with. */
    function icon(paths) {
        return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
            ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    }
    var ICONS = {
        target: icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>'),
        dollar: icon('<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
        trendingUp: icon('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
        layers: icon('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
        plusCircle: icon('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>'),
        percent: icon('<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
        landmark: icon('<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>'),
        activity: icon('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
        shuffle: icon('<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>')
    };

    var schema = {
        /* Which groups belong to the Profile tab (baseline facts shared by
         * every tab) vs. the Planner tab (simulation assumptions). Date of
         * birth is rendered by the Profile tab itself — it lives on the
         * store's `profile`, not in the numeric `inputs`. */
        profileGroups: ['goals', 'baseline', 'taxes', 'irs'],
        plannerGroups: ['savings', 'buckets', 'employer', 'market', 'montecarlo'],

        groups: [
            {
                id: 'goals', title: 'Retirement goals', icon: ICONS.target,
                blurb: 'When you want out.',
                fields: [
                    { key: 'retireAge', label: 'Early retirement age', step: 1, min: 25, max: 80 },
                    { key: 'standardRetireAge', label: 'Penalty-free deferred access age', step: 1, min: 50, max: 75, hint: 'Usually 59½ (modeled as 60). Enter 55 only if your employer plan qualifies for the Rule of 55, and note that rule covers only that employer\'s 401k, not IRAs or Roth IRAs, while this age unlocks every account in the model.' }
                ]
            },
            {
                id: 'baseline', title: 'Income & spending', icon: ICONS.dollar,
                blurb: 'What comes in and what goes out today.',
                fields: [
                    { key: 'income', label: 'Annual gross income', unit: '$', step: 1000 },
                    { key: 'incomeTaxRate', label: 'Effective income tax', unit: '%', step: 1, min: 0, max: 60, hint: 'All payroll and income taxes as a share of gross pay. The Cashbook uses it to estimate monthly take-home when a month has no income transactions.' },
                    { key: 'expenses', label: 'Current annual expenses', unit: '$', step: 1000 }
                ]
            },
            {
                id: 'savings', title: 'Savings behavior', icon: ICONS.trendingUp,
                blurb: 'How much you keep, and how it grows.',
                fields: [
                    { key: 'savingsRate', label: 'Starting savings rate', unit: '%', step: 1 },
                    { key: 'savingsRateIncrease', label: 'Savings rate increase / yr', unit: '%', step: 0.5 },
                    { key: 'maxSavingsRate', label: 'Savings rate cap', unit: '%', step: 1 },
                    { key: 'incomeGrowth', label: 'Income growth rate', unit: '%', step: 0.1 }
                ]
            },
            {
                id: 'buckets', title: 'Current buckets', icon: ICONS.layers,
                blurb: 'Where your money sits today.',
                fields: [
                    { key: 'balDeferred', label: 'Tax-deferred (401k / IRA)', unit: '$', step: 1000, bucket: 'deferred' },
                    { key: 'balFree', label: 'Tax-free (Roth)', unit: '$', step: 1000, bucket: 'free' },
                    { key: 'balTaxable', label: 'After-tax (brokerage)', unit: '$', step: 1000, bucket: 'taxable' },
                    { key: 'balCash', label: 'Cash on hand', unit: '$', step: 500, bucket: 'cash', hint: 'Counts toward net worth but sits outside the market — the projection never grows it and never draws it down.' }
                ]
            },
            {
                id: 'employer', title: 'Employer match', icon: ICONS.plusCircle,
                blurb: 'Free money from your employer.',
                fields: [
                    { key: 'employerMatchRate', label: 'Match rate', unit: '%', step: 5, hint: '% of your 401k contribution your employer matches' },
                    { key: 'employerMatchCap', label: 'Match cap', unit: '%', step: 0.5, hint: 'Matched on contributions up to this % of salary' }
                ]
            },
            {
                id: 'irs', title: 'IRS contribution limits', icon: ICONS.landmark,
                blurb: 'The 2026 statutory ceilings on tax-advantaged saving — update them when the IRS does.',
                fields: [
                    { key: 'limit401k', label: '401k employee limit', unit: '$', step: 500, hint: '2026 IRS cap. Indexed to inflation each projection year; update when the IRS changes it.' },
                    { key: 'limitIRA', label: 'IRA / Roth limit', unit: '$', step: 500, hint: '2026 IRS cap, indexed to inflation in the projection.' },
                    { key: 'catchUp401k', label: '401k catch-up (50+)', unit: '$', step: 500, hint: '2026 IRS catch-up for ages 50+. Ages 60–63 use the super catch-up instead.' },
                    { key: 'superCatchUp401k', label: '401k super catch-up (60–63)', unit: '$', step: 250, hint: '2026 IRS cap under SECURE 2.0; replaces the regular 401k catch-up for ages 60–63.' },
                    { key: 'catchUpIRA', label: 'IRA catch-up (50+)', unit: '$', step: 100, hint: '2026 IRS catch-up.' }
                ]
            },
            {
                id: 'taxes', title: 'Withdrawal taxes', icon: ICONS.percent,
                blurb: 'Effective rates applied when you draw money out.',
                fields: [
                    { key: 'taxDeferredRate', label: 'Tax-deferred draws', unit: '%', step: 1, hint: 'Effective income tax on 401k / IRA withdrawals' },
                    { key: 'taxTaxableRate', label: 'Brokerage draws', unit: '%', step: 1, hint: 'Applied to the whole withdrawal, not just the gain. If about half of a typical draw is gains taxed at 15%, enter 7-8%. Roth draws are tax-free.' },
                    { key: 'earlyPenaltyRate', label: 'Early-withdrawal penalty', unit: '%', step: 1, min: 0, max: 50, hint: 'Extra charge on tax-deferred draws before the penalty-free access age (the IRS rate is 10%). Set 0 for Rule of 55 or 72(t)/SEPP plans. Roth draws are modeled penalty-free, as contribution withdrawals.' }
                ]
            },
            {
                id: 'market', title: 'Market assumptions', icon: ICONS.activity,
                blurb: 'The world your plan lives in.',
                fields: [
                    { key: 'marketReturn', label: 'Market return', unit: '%', step: 0.1 },
                    { key: 'inflation', label: 'Inflation rate', unit: '%', step: 0.1 },
                    { key: 'swr', label: 'Safe withdrawal rate', unit: '%', step: 0.1 }
                ]
            },
            {
                id: 'montecarlo', title: 'Monte Carlo', icon: ICONS.shuffle,
                blurb: 'How the resilience check stress-tests your plan against random market futures.',
                fields: [
                    { key: 'volatility', label: 'Return volatility', unit: '%', step: 1, hint: 'Annual std-dev used by the Monte Carlo simulation' },
                    { key: 'mcSims', label: 'Simulations', step: 100, min: 50, max: 2000, hint: '50–2,000. More runs are steadier but slower.' }
                ]
            }
        ],

        expertKeys: function () {
            var keys = [];
            this.groups.forEach(function (g) {
                g.fields.forEach(function (f) { if (g.expert || f.expert) keys.push(f.key); });
            });
            return keys.concat([
                'drawTaxableBridge', 'drawDeferredBridge', 'drawFreeBridge',
                'drawTaxableStd', 'drawDeferredStd', 'drawFreeStd'
            ]);
        },

        hiddenCustomCount: function (state) {
            var count = this.expertKeys().reduce(function (n, key) {
                return n + (Number(state.inputs[key]) !== Number(FireEngine.DEFAULTS[key]) ? 1 : 0);
            }, 0);
            var phases = state.phases || [];
            var defaults = FireEngine.DEFAULT_PHASES;
            var phaseFields = ['age', 'deferred', 'free', 'taxable'];
            var same = phases.length === defaults.length && phases.every(function (p, i) {
                return phaseFields.every(function (key) {
                    var expected = key === 'age' && defaults[i].isLocked ? state.inputs.currentAge : defaults[i][key];
                    return Number(p[key]) === Number(expected);
                });
            });
            return count + (same ? 0 : 1);
        },

        assumptionsText: function (state) {
            var count = this.hiddenCustomCount(state);
            return count
                ? 'Simplified view. ' + count + ' setting' + (count === 1 ? ' was' : 's were') + ' customized in Expert mode and ' + (count === 1 ? 'is' : 'are') + ' still in effect.'
                : 'Simplified view. Taxes, contribution limits, inflation and the 4% withdrawal rule are running on standard assumptions.';
        },

        bucketMeta: {
            deferred: { label: 'Tax-Deferred', short: 'Deferred', desc: '401k / IRA' },
            free: { label: 'Tax-Free', short: 'Roth', desc: 'Roth accounts' },
            taxable: { label: 'After-Tax', short: 'Brokerage', desc: 'Brokerage' }
        }
    };

    var expertGroups = { taxes: true, irs: true, montecarlo: true };
    var expertFields = {
        standardRetireAge: true, incomeTaxRate: true,
        savingsRateIncrease: true, maxSavingsRate: true, incomeGrowth: true,
        inflation: true, swr: true
    };
    schema.groups.forEach(function (group) {
        if (expertGroups[group.id]) group.expert = true;
        if (group.id === 'employer') {
            group.beginnerToggle = { key: 'employerMatchRate', label: 'My employer matches 401k contributions' };
        }
        group.fields.forEach(function (field) { if (expertFields[field.key]) field.expert = true; });
    });

    global.FireSchema = schema;

})(typeof window !== 'undefined' ? window : globalThis);
