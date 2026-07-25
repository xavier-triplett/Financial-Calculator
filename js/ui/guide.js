/* UI: GUIDE — a static, plain-language walkthrough of Coast FIRE and the app,
 * written for someone with no finance background. No state, no charts. */
(function (global) {
    'use strict';

    function dt(term, def) {
        return '<div class="gd-term"><dt>' + term + '</dt><dd>' + def + '</dd></div>';
    }

    function template() {
        return '' +
        '<div class="gd-shell">' +
            '<header class="gd-masthead">' +
                '<div>' +
                    '<span class="gd-eyebrow">The manual</span>' +
                    '<h1>Guide</h1>' +
                    '<span class="gd-sub">Coast FIRE, the three buckets, and every term in the app &mdash; in plain language.</span>' +
                '</div>' +
            '</header>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">The idea</div>' +
                '<p><strong>FIRE</strong> stands for <em>Financial Independence, Retire Early</em>: save enough, invested well, ' +
                'that work becomes optional long before the traditional retirement age.</p>' +
                '<p><strong>Coast FIRE</strong> is the gentler cousin. Saving early can put enough in your accounts that modeled compounding alone &mdash; with no further saving &mdash; ' +
                'will grow it into a full retirement by the time you need it. Past that point you are &ldquo;coasting&rdquo;: you still work ' +
                'to pay the bills, but every dollar of retirement is already planted.</p>' +
                '<p>This app models your specific version of that story: your income, your savings, your accounts &mdash; projected year by ' +
                'year to age 95, and stress-tested against thousands of possible markets.</p>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">Three retirement paths</div>' +
                '<p><strong>Traditional retirement</strong> keeps contributions going until retirement. <strong>Coast FIRE</strong> ' +
                'stops retirement contributions at the coast age while you keep working to cover current living costs. ' +
                '<strong>Early FIRE</strong> keeps saving until an early retirement and then draws from the portfolio.</p>' +
                '<p>The path is not just a label. On the Coast FIRE path, the year-by-year projection records a distinct coasting phase ' +
                'with no new contributions, while income and expenses continue until full retirement.</p>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">Two models</div>' +
                '<p><strong>Beginner</strong> is a simpler simulation, not a shorter version of the expert one. It keeps a small set ' +
                'of modeling choices printed in full on the Profile tab: one savings rate that never ' +
                'ramps, growth after inflation, no guessed taxes, a 4% withdrawal guideline, an age-60 retirement-access checkpoint, and 2026 federal contribution limits. Your allocation and employer match remain editable. Because inflation ' +
                'is taken out rather than modeled, every figure reads in today\'s dollars.</p>' +
                '<p><strong>Expert</strong> hands you all of it: every rate, saving phase, drawdown rule and diagnostic, projected in ' +
                'future dollars. Expert-only tax, market, drawdown, and simulation inputs do not leak into a beginner run; personal facts exposed in both modes stay shared. The same plan can report two ' +
                'different numbers in the two modes. That is the two models disagreeing, not an error, and the biggest reason is the ' +
                'unit: a target in today\'s dollars is a much smaller number than the same target decades of inflation later.</p>' +
                '<p>Use the Beginner / Expert control in the top bar to switch.</p>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">The coast number</div>' +
                '<p>The Planner calculates the spendable value your invested accounts need <em>today</em> for market growth alone, ' +
                'with no new savings, to reach your full retirement target at the later of retirement or account access. Compare it with your Roth and brokerage balances ' +
                'plus your deferred balance after any modeled withdrawal tax. Cash stays outside this long-term investment comparison.</p>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">The three buckets</div>' +
                '<p>For a lightweight comparison, the app groups invested money into three buckets. Actual tax and access treatment depends on account type, plan terms, and personal circumstances:</p>' +
                '<div class="gd-buckets">' +
                    '<div class="gd-bucket"><h3>Tax&#8209;Deferred</h3><span class="gd-bucket-eg">401k &middot; Traditional IRA</span>' +
                        '<p>Traditional contributions may receive current tax treatment and withdrawals are generally taxable. Early distributions may also face an additional tax unless an exception applies.</p></div>' +
                    '<div class="gd-bucket"><h3>Tax&#8209;Free</h3><span class="gd-bucket-eg">Roth IRA &middot; Roth 401k</span>' +
                        '<p>Qualified Roth distributions can be tax-free. Roth IRA distribution ordering is more nuanced than this model; enter only regular Roth IRA contribution basis you want treated as available early.</p></div>' +
                    '<div class="gd-bucket"><h3>After&#8209;Tax</h3><span class="gd-bucket-eg">Brokerage account</span>' +
                        '<p>An ordinary taxable investment account without a retirement-account age gate. The app can use it during an early-retirement bridge.</p></div>' +
                '</div>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">The bridge</div>' +
                '<p>Say you retire at 50 but choose age 60 as the simplified account-access checkpoint. Those ten years are <strong>the bridge</strong> &mdash; ' +
                'and your accessible balances need to carry those years. The app reports this as a separate milestone so a large total balance does not hide an access gap.</p>' +
                '<p>If the bridge fails, the projection keeps going by tapping tax-deferred accounts early, using any tax and early-withdrawal rates in the selected model. Roth balances stay unavailable until the modeled access age.</p>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">How to use the app</div>' +
                '<ol class="gd-steps">' +
                    '<li><strong>Profile</strong> &mdash; explicitly choose Traditional retirement, Coast FIRE, or Early FIRE when you want a projection. ' +
                    'Date of birth and annual expenses place it on a timeline. Income remains optional. Expert mode adds editable tax estimates, contribution limits, and access age.</li>' +
                    '<li><strong>Planner</strong> &mdash; set the assumptions: your savings rate, how each saved dollar splits across the ' +
                    'three buckets, employer match, and what you expect from the market. Beginner uses its stated 2026 contribution limits; Expert lets you replace them. No employer match is assumed.</li>' +
                    '<li><strong>Read the verdicts</strong> &mdash; the first two stamps adapt to the selected path: reaching the coast and ' +
                    'coasting to retirement, funding an early-retirement bridge, or reaching a traditional retirement. Resilience shows how many simulated market ' +
                    'futures still leave you with money at 95.</li>' +
                    '<li><strong>Experiment</strong> &mdash; every change recalculates instantly. Try retiring two years later, or saving ' +
                    '5% more, and watch what it does to the verdicts. The small &#9432; icons explain each field.</li>' +
                    '<li><strong>Track reality</strong> &mdash; record actual account balances on any date in <strong>Net Worth</strong>, and ' +
                    'actual income and spending in <strong>Cashbook</strong> (by hand, or import a transaction CSV). Each tracker can propose ' +
                    'updates to the plan so you can review the effect before replacing an estimate. Use <strong>Categories</strong> to control transaction types and CSV columns, and <strong>Data</strong> for backups and freshness.</li>' +
                '</ol>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">Reading the verdicts</div>' +
                '<dl class="gd-gloss">' +
                    dt('READY / SECURE', 'The selected path reaches its current milestone: the Coast target, retirement-readiness checkpoint, or early-retirement bridge. The note below the stamp names the exact test.') +
                    dt('DEPLETES AT &hellip;', 'The projection runs dry at this age. Treat it as a scenario to improve: save more, spend less, retire later, or rebalance the buckets.') +
                    dt('&hellip;% funded', 'Your projected spendable invested balance at the relevant path milestone versus the nest egg the safe-withdrawal rule says a full retirement needs. It includes brokerage and tax-adjusts deferred money when the selected model includes taxes; cash is excluded.') +
                    dt('Resilience %', 'The share of 2,000 randomized market futures (booms, crashes, flat decades) where you still have money at 95. Annual returns are calibrated so their arithmetic average and standard deviation match your market-return and volatility assumptions. A typical compounded path can be lower because volatility compounds unevenly.') +
                '</dl>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">Glossary</div>' +
                '<dl class="gd-gloss">' +
                    dt('Net worth', 'Everything you own (cash, investments, property) minus everything you owe (loans, cards). The single number the trackers watch.') +
                    dt('Savings rate', 'The share of your gross income you plan to put away. Beginner caps actual saving at gross pay left after expenses because it does not model taxes; Expert uses modeled take-home pay. The first constrained year is flagged. ' +
                        'In the Cashbook, transactions in savings-kind categories count as deliberate contributions &mdash; when you mark them, ' +
                        'the observed rate uses those actuals instead of assuming every surplus dollar was saved.') +
                    dt('Compounding', 'Growth on top of growth: returns earned by past returns. The reason money saved at 25 counts several times more than money saved at 45.') +
                    dt('401k', 'An employer-sponsored retirement plan. Available contribution types, matching, eligibility, vesting, limits, and withdrawal options depend on the plan.') +
                    dt('IRA', 'An Individual Retirement Arrangement you open through a financial institution. Contribution eligibility, Roth eligibility, and traditional deduction treatment can depend on compensation, income, workplace coverage, and filing status.') +
                    dt('Roth', 'A tax treatment available in some IRAs and workplace plans. Qualified distributions can be tax-free, while nonqualified distributions and conversions can require more detailed handling than this app models.') +
                    dt('Brokerage account', 'An ordinary taxable investment account. No tax perks, no age locks.') +
                    dt('Employer match', 'An optional employer contribution described by your workplace plan. Enter your own match rate and eligible-pay cap; the app assumes none. The projection places modeled match dollars in the tax-deferred bucket.') +
                    dt('Contribution limits', 'The app fills workplace capacity first, then IRA capacity, while preserving your allocation. Beginner uses its stated 2026 federal baseline; Expert lets you edit each amount. Eligibility, compensation limits, deductibility, and plan-specific restrictions are not calculated.') +
                    dt('Account access age', 'The annual projection uses one checkpoint for retirement-account access: age 60 in Beginner and editable in Expert. Roth balances are unavailable before it. Real distribution access and additional-tax exceptions vary by account, employment separation, plan terms, and circumstances.') +
                    dt('Effective tax rate', 'Your total tax as a share of the money in question &mdash; a blend of all the brackets, not your top bracket. Expert applies one effective rate to deferred withdrawals and another to the full amount of each brokerage withdrawal; Beginner does not guess or model taxes.') +
                    dt('Capital gains', 'Profit from selling an investment for more than you paid. The app does not track tax basis or holding period; it applies any brokerage-draw estimate you enter to the <em>entire</em> withdrawal. Leave it at 0 unless a simplified blended estimate is useful to you.') +
                    dt('Inflation', 'The slow rise of prices. The plan grows your expenses and the IRS limits with it, so a plan that works &ldquo;in today&rsquo;s dollars&rdquo; still works in 2050&rsquo;s dollars.') +
                    dt('Market return', 'An editable average yearly growth assumption, not a forecast. Beginner uses a published fixed real-growth scenario; Expert lets you replace it.') +
                    dt('Volatility', 'How wildly returns swing year to year. Two plans with the same average return can have very different fates if one hits a crash early in retirement.') +
                    dt('Monte Carlo simulation', 'Instead of assuming one smooth average future, the app rolls thousands of random-but-realistic market histories and counts how many your plan survives.') +
                    dt('Safe withdrawal rate', 'A planning percentage used to turn annual spending into a target, not a promise that money will last. The Beginner scenario uses a 4% guideline. Target = yearly expenses &divide; the entered rate.') +
                    dt('PAW / AAW / UAW', 'Benchmarks from &ldquo;The Millionaire Next Door&rdquo; for how much wealth your age and income &ldquo;should&rdquo; have produced. AAW (average) = age &times; income &divide; 10; PAW (prodigious) is twice that; UAW (under) is half. The Net Worth chart plots you against all three.') +
                '</dl>' +
            '</section>' +

            '<p class="gd-foot">Your data stays in your browser unless you choose to sign in. And the obvious disclaimer: this is a ' +
            'planning model, not financial advice &mdash; it simplifies taxes and markets, and reality will do something different.</p>' +
        '</div>';
    }

    function mount(root) {
        root.innerHTML = template();
    }

    function update() { /* static page — nothing to refresh */ }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'guide', name: 'Guide', tag: 'Coast FIRE and the app, explained plainly',
        mount: mount, update: update
    });

})(window);
