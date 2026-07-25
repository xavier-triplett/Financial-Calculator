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
        profileGroups: ['timeline', 'baseline', 'taxes', 'irs'],
        plannerGroups: ['savings', 'beginnerAllocation', 'buckets', 'employer', 'irs', 'market', 'montecarlo'],

        groups: [
            {
                id: 'timeline', title: 'Projection timeline', icon: ICONS.target,
                blurb: 'Editable ages used by the selected retirement path.',
                fields: [
                    { key: 'coastAge', label: 'Coast age', step: 1, min: 25, max: 80, hint: 'The age when retirement contributions stop. You keep working to cover living expenses while invested retirement balances grow on their own.' },
                    { key: 'retireAge', label: 'Full retirement age', step: 1, min: 25, max: 80 },
                    { key: 'standardRetireAge', label: 'Retirement-account access age', step: 1, min: 0, max: 95, hint: 'Enter the age you want this simplified projection to make all modeled retirement balances available. Actual access, taxes, and penalties depend on account type and your circumstances.' }
                ]
            },
            {
                id: 'baseline', title: 'Income & spending', icon: ICONS.dollar,
                blurb: 'What comes in and what goes out today.',
                fields: [
                    { key: 'income', label: 'Annual gross income (optional)', unit: '$', step: 1000, min: 0, max: 1000000000000000, hint: 'Leave 0 to project no future employee contributions. This does not affect your ability to store balances or transactions.' },
                    { key: 'incomeTaxRate', label: 'Effective pay tax estimate (optional)', unit: '%', step: 1, min: 0, max: 60, hint: 'Optional combined estimate for payroll and income taxes as a share of gross pay. Leave 0 to model no pay tax. Filing status, deductions, credits, state, and local taxes are not inferred.' },
                    { key: 'expenses', label: 'Current annual expenses', unit: '$', step: 1000, min: 0, max: 1000000000000000 }
                ]
            },
            {
                id: 'savings', title: 'Savings behavior', icon: ICONS.trendingUp,
                blurb: 'How much you keep, and how it grows.',
                beginnerBlurb: 'The share of your pay you save. The same rate every year.',
                fields: [
                    { key: 'savingsRate', label: 'Starting savings rate', unit: '%', step: 1, min: 0, max: 100 },
                    { key: 'savingsRateIncrease', label: 'Savings rate increase / yr', unit: '%', step: 0.5, min: 0, max: 100 },
                    { key: 'maxSavingsRate', label: 'Savings rate cap', unit: '%', step: 1, min: 0, max: 100 },
                    { key: 'incomeGrowth', label: 'Income growth rate', unit: '%', step: 0.1, min: -99, max: 100 }
                ]
            },
            {
                id: 'beginnerAllocation', title: 'Where new savings go', icon: ICONS.layers,
                blurb: 'Optional percentages for new savings. The remainder goes to brokerage.',
                beginnerOnly: true,
                fields: [
                    { key: 'beginnerDeferredShare', label: 'To tax-deferred accounts', unit: '%', step: 5, min: 0, max: 100, hint: 'Use only the share you expect to contribute to a traditional workplace plan or IRA.' },
                    { key: 'beginnerFreeShare', label: 'To Roth accounts', unit: '%', step: 5, min: 0, max: 100, hint: 'Use only the share you expect to contribute to Roth accounts. The two percentages cannot exceed 100%.' }
                ]
            },
            {
                id: 'buckets', title: 'Current buckets', icon: ICONS.layers,
                blurb: 'Where your money sits today.',
                fields: [
                    { key: 'balDeferred', label: 'Tax-deferred (401k / IRA)', unit: '$', step: 1000, min: 0, max: 1000000000000000, bucket: 'deferred' },
                    { key: 'balFree', label: 'Tax-free (Roth)', unit: '$', step: 1000, min: 0, max: 1000000000000000, bucket: 'free' },
                    { key: 'rothContributionBasis', label: 'Accessible Roth contributions (optional)', unit: '$', step: 500, min: 0, max: 1000000000000000, bucket: 'free', hint: 'Enter only regular Roth IRA contributions in the current balance that you expect to be available before the access age. Exclude earnings, conversions, and workplace Roth contributions.' },
                    { key: 'balTaxable', label: 'After-tax (brokerage)', unit: '$', step: 1000, min: 0, max: 1000000000000000, bucket: 'taxable' },
                    { key: 'balCash', label: 'Cash on hand', unit: '$', step: 500, min: 0, max: 1000000000000000, bucket: 'cash', hint: 'Counts toward net worth but sits outside the market — the projection never grows it and never draws it down.' }
                ]
            },
            {
                id: 'employer', title: 'Employer match', icon: ICONS.plusCircle,
                blurb: 'Optional terms from your own workplace plan. Leave both at 0 when there is no match.',
                fields: [
                    { key: 'employerMatchRate', label: 'Employer match rate (optional)', unit: '%', step: 5, min: 0, max: 100, hint: 'The percentage of your eligible workplace-plan contributions your employer matches. Example: enter 50 for a 50-cent match per dollar.' },
                    { key: 'employerMatchCap', label: 'Eligible pay cap (optional)', unit: '%', step: 0.5, min: 0, max: 100, hint: 'The share of salary up to which contributions are matched. Enter the terms from your plan; none are assumed.' }
                ]
            },
            {
                id: 'irs', title: 'Contribution access & limits', icon: ICONS.landmark,
                blurb: 'Optional annual amounts available to you. The model fills the workplace plan first, then the IRA; it does not determine eligibility or tax treatment.',
                fields: [
                    { key: 'limit401k', label: 'Workplace-plan annual limit (optional)', unit: '$', step: 500, min: 0, max: 1000000000, hint: 'Enter the annual employee contribution amount available under your plan. Leave 0 if unavailable or not modeled.' },
                    { key: 'limitIRA', label: 'IRA annual limit (optional)', unit: '$', step: 500, min: 0, max: 1000000000, hint: 'Enter the annual contribution amount you want modeled. Eligibility and deductibility are not calculated.' },
                    { key: 'catchUpAge', label: 'Catch-up start age (optional)', step: 1, min: 0, max: 95, hint: 'Age when the optional workplace and IRA catch-up amounts below begin. The app does not determine whether you qualify.' },
                    { key: 'catchUp401k', label: 'Workplace catch-up (optional)', unit: '$', step: 500, min: 0, max: 1000000000, hint: 'Additional annual workplace-plan amount available at eligible ages. Verify your plan and current law.' },
                    { key: 'superCatchUp401k', label: 'Age 60–63 workplace catch-up (optional)', unit: '$', step: 250, min: 0, max: 1000000000, hint: 'Additional amount to use at ages 60–63. Leave 0 unless it applies to you.' },
                    { key: 'catchUpIRA', label: 'IRA catch-up (optional)', unit: '$', step: 100, min: 0, max: 1000000000, hint: 'Additional annual IRA amount available at eligible ages. Leave 0 unless it applies to you.' }
                ]
            },
            {
                id: 'taxes', title: 'Withdrawal taxes', icon: ICONS.percent,
                blurb: 'Optional effective estimates applied when money is withdrawn. Leave 0 to omit each one.',
                fields: [
                    { key: 'taxDeferredRate', label: 'Tax-deferred draw tax (optional)', unit: '%', step: 1, min: 0, max: 99, hint: 'Your editable effective estimate for tax on traditional retirement-account withdrawals. The app does not infer brackets or filing status.' },
                    { key: 'taxTaxableRate', label: 'Brokerage draw tax (optional)', unit: '%', step: 1, min: 0, max: 99, hint: 'Applied to the whole modeled withdrawal, not only gains. Enter a blended estimate only if useful for your scenario.' },
                    { key: 'earlyPenaltyRate', label: 'Early-withdrawal charge (optional)', unit: '%', step: 1, min: 0, max: 50, hint: 'Optional extra charge on tax-deferred draws before the access age you entered. The app does not determine whether an exception applies.' }
                ]
            },
            {
                id: 'market', title: 'Market assumptions', icon: ICONS.activity,
                blurb: 'The world your plan lives in.',
                fields: [
                    { key: 'marketReturn', label: 'Average market return', unit: '%', step: 0.1, min: -99, max: 100 },
                    { key: 'inflation', label: 'Inflation rate', unit: '%', step: 0.1, min: -99, max: 100 },
                    { key: 'swr', label: 'Safe withdrawal rate', unit: '%', step: 0.1, min: 0.1, max: 100 }
                ]
            },
            {
                id: 'montecarlo', title: 'Monte Carlo', icon: ICONS.shuffle,
                blurb: 'How the resilience check stress-tests your plan against random market futures.',
                fields: [
                    { key: 'volatility', label: 'Return volatility', unit: '%', step: 1, min: 0, max: 100, hint: 'Arithmetic annual standard deviation used by the Monte Carlo simulation' },
                    { key: 'mcSims', label: 'Simulations', step: 100, min: 50, max: 2000, hint: '50–2,000. More runs are steadier but slower.' }
                ]
            }
        ],

        /* Groups a mode renders, and the fields inside them. Beginner drops a
         * group entirely rather than rendering it empty. */
        groupsFor: function (ids, beginner) {
            return this.groups.filter(function (g) {
                if (ids && ids.indexOf(g.id) === -1) return false;
                if (!beginner) return !g.beginnerOnly;
                return g.beginnerToggle || g.fields.some(function (f) { return f.beginner; });
            });
        },

        fieldsFor: function (group, beginner) {
            return beginner ? group.fields.filter(function (f) { return f.beginner; }) : group.fields;
        },

        /* Beginner labels differ where the expert wording names a dial that
         * beginner does not have (a starting rate implies a ramp). */
        fieldLabel: function (field, beginner) {
            return beginner && field.beginnerLabel ? field.beginnerLabel : field.label;
        },

        bucketMeta: {
            deferred: { label: 'Tax-Deferred', short: 'Deferred', desc: '401k / IRA' },
            free: { label: 'Tax-Free', short: 'Roth', desc: 'Roth accounts' },
            taxable: { label: 'After-Tax', short: 'Brokerage', desc: 'Brokerage' }
        },

        planTypes: [
            {
                id: FireEngine.PLAN_TYPES.TRADITIONAL,
                name: 'Traditional retirement',
                short: 'Traditional',
                description: 'Keep saving throughout your career, then retire on your target date.'
            },
            {
                id: FireEngine.PLAN_TYPES.COAST,
                name: 'Coast FIRE',
                short: 'Coast FIRE',
                description: 'Stop retirement contributions at your coast age, then work only to cover living costs.'
            },
            {
                id: FireEngine.PLAN_TYPES.EARLY,
                name: 'Early FIRE',
                short: 'Early FIRE',
                description: 'Save until early retirement, then fund the years before retirement accounts unlock.'
            }
        ],

        planType: function (id) {
            return this.planTypes.find(function (type) { return type.id === Number(id); }) || this.planTypes[1];
        }
    };

    /* A field is editable in Beginner only if the beginner model actually
     * reads it. Deriving this from the engine keeps the two from drifting
     * into a field the user can type into that changes nothing. */
    var beginnerLabels = { savingsRate: 'Savings rate' };
    schema.groups.forEach(function (group) {
        group.fields.forEach(function (field) {
            field.beginner = FireEngine.BEGINNER_OWNED.indexOf(field.key) !== -1;
            if (beginnerLabels[field.key]) field.beginnerLabel = beginnerLabels[field.key];
        });
    });

    global.FireSchema = schema;

})(typeof window !== 'undefined' ? window : globalThis);
