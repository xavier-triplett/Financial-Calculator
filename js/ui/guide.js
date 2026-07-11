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
                '<p><strong>Coast FIRE</strong> is the gentler cousin. Because invested money roughly doubles every decade on its own, ' +
                'saving hard <em>early</em> can put enough in your accounts that compounding alone &mdash; with no further saving &mdash; ' +
                'will grow it into a full retirement by the time you need it. Past that point you are &ldquo;coasting&rdquo;: you still work ' +
                'to pay the bills, but every dollar of retirement is already planted.</p>' +
                '<p>This app models your specific version of that story: your income, your savings, your accounts &mdash; projected year by ' +
                'year to age 95, and stress-tested against thousands of possible markets.</p>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">The three buckets</div>' +
                '<p>Retirement money isn&rsquo;t one pile &mdash; the tax rules split it into three, and the difference matters enormously ' +
                'for <em>when</em> you can spend it:</p>' +
                '<div class="gd-buckets">' +
                    '<div class="gd-bucket"><h3>Tax&#8209;Deferred</h3><span class="gd-bucket-eg">401k &middot; Traditional IRA</span>' +
                        '<p>You skip taxes now, pay income tax when you withdraw. The catch: touching it before roughly age 60 ' +
                        'usually costs a 10% penalty.</p></div>' +
                    '<div class="gd-bucket"><h3>Tax&#8209;Free</h3><span class="gd-bucket-eg">Roth IRA &middot; Roth 401k</span>' +
                        '<p>You pay taxes now; growth and withdrawals are tax-free forever. Also locked until roughly 60 ' +
                        '(with some exceptions for what you contributed).</p></div>' +
                    '<div class="gd-bucket"><h3>After&#8209;Tax</h3><span class="gd-bucket-eg">Brokerage account</span>' +
                        '<p>A normal investment account. No special tax breaks &mdash; but no lock, either. You can spend it at any age. ' +
                        'This is what funds an <em>early</em> retirement.</p></div>' +
                '</div>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">The bridge</div>' +
                '<p>Say you retire at 50 but your 401k and Roth stay locked until 60. Those ten years are <strong>the bridge</strong> &mdash; ' +
                'and your brokerage has to carry every year of it alone. The app treats this as its own goal because it&rsquo;s the most ' +
                'common way early-retirement plans fail: plenty of money in total, but locked behind the wrong door at the wrong time.</p>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">How to use the app</div>' +
                '<ol class="gd-steps">' +
                    '<li><strong>Profile</strong> &mdash; enter the facts: date of birth, gross income, annual expenses, the age you want ' +
                    'to stop working, and the age your retirement accounts unlock. Every tab reads from here.</li>' +
                    '<li><strong>Planner</strong> &mdash; set the assumptions: your savings rate, how each saved dollar splits across the ' +
                    'three buckets, employer match, tax rates on withdrawals, and what you expect from the market. The defaults are ' +
                    'reasonable &mdash; start by only changing what you know.</li>' +
                    '<li><strong>Read the verdicts</strong> &mdash; the stamps at the top of the Planner. Goal I: does the bridge hold? ' +
                    'Goal II: is the rest of your life funded once everything unlocks? Resilience: how many of 2,000 simulated market ' +
                    'futures still leave you with money at 95.</li>' +
                    '<li><strong>Experiment</strong> &mdash; every change recalculates instantly. Try retiring two years later, or saving ' +
                    '5% more, and watch what it does to the verdicts. The small &#9432; icons explain each field.</li>' +
                    '<li><strong>Track reality</strong> &mdash; record actual account balances each month in <strong>Net Worth</strong>, and ' +
                    'actual income and spending in <strong>Cashbook</strong> (by hand, or import a Rocket Money CSV). Each tracker can push ' +
                    'its actuals back into the plan, replacing your guesses with the real numbers.</li>' +
                '</ol>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">Reading the verdicts</div>' +
                '<dl class="gd-gloss">' +
                    dt('SECURE', 'The projection never runs out of money in that phase. For the bridge, the brokerage lasts until your accounts unlock; for the coast, funds last to 95.') +
                    dt('DEPLETED / Broke at &hellip;', 'The projection runs dry, and the age it happens. Save more, spend less, retire later, or rebalance the buckets.') +
                    dt('&hellip;% funded', 'Your projected net worth at unlock age versus the amount the safe-withdrawal rule says a full retirement needs. 100% or more earns the SECURE stamp.') +
                    dt('Resilience %', 'The share of 2,000 randomized market futures (booms, crashes, flat decades) where you still have money at 95. The single average-return projection can look fine while many bad-luck futures fail &mdash; this number tells you how lucky you&rsquo;d need to be.') +
                '</dl>' +
            '</section>' +

            '<section class="gd-card">' +
                '<div class="gd-card-title">Glossary</div>' +
                '<dl class="gd-gloss">' +
                    dt('Net worth', 'Everything you own (cash, investments, property) minus everything you owe (loans, cards). The single number the trackers watch.') +
                    dt('Savings rate', 'The share of your gross income you put away rather than spend. The most powerful dial in the whole plan.') +
                    dt('Compounding', 'Growth on top of growth: returns earned by past returns. The reason money saved at 25 counts several times more than money saved at 45.') +
                    dt('401k', 'A retirement account offered through an employer. Contributions come out of your paycheck pre-tax, and employers often add matching money.') +
                    dt('IRA', 'An Individual Retirement Account you open yourself &mdash; same tax-deferred idea as a 401k, with its own (lower) contribution limit.') +
                    dt('Roth', 'The tax-free flavor of a 401k or IRA: contributions are taxed going in, then never again.') +
                    dt('Brokerage account', 'An ordinary taxable investment account. No tax perks, no age locks.') +
                    dt('Employer match', 'Free money: your employer contributes to your 401k in proportion to what you contribute, up to a cap. The plan models both the rate and the cap.') +
                    dt('Contribution limits', 'The IRS caps how much can go into a 401k or IRA each year. The caps rise with inflation, and people 50+ may add an extra &ldquo;catch-up&rdquo; amount (ages 60&ndash;63 get a larger &ldquo;super catch-up&rdquo;). Savings past the caps spill into the brokerage.') +
                    dt('Penalty-free access age', 'The age your tax-advantaged accounts unlock &mdash; usually 59&frac12; (the app models 60). Some employer plans allow access at 55 if you leave the job then (the &ldquo;Rule of 55&rdquo;).') +
                    dt('Effective tax rate', 'Your total tax as a share of the money in question &mdash; a blend of all the brackets, not your top bracket. The app applies one effective rate to deferred withdrawals and another to brokerage gains.') +
                    dt('Capital gains', 'Profit from selling an investment for more than you paid. Brokerage withdrawals are taxed on this profit, typically at lower rates than income.') +
                    dt('Inflation', 'The slow rise of prices. The plan grows your expenses and the IRS limits with it, so a plan that works &ldquo;in today&rsquo;s dollars&rdquo; still works in 2050&rsquo;s dollars.') +
                    dt('Market return', 'The average yearly growth you expect from investments. Long-run stock-market history is roughly 9&ndash;10% before inflation &mdash; the default here is deliberately more modest.') +
                    dt('Volatility', 'How wildly returns swing year to year. Two plans with the same average return can have very different fates if one hits a crash early in retirement.') +
                    dt('Monte Carlo simulation', 'Instead of assuming one smooth average future, the app rolls thousands of random-but-realistic market histories and counts how many your plan survives.') +
                    dt('Safe withdrawal rate', 'The share of your portfolio you can spend each year with good odds of never running out &mdash; the classic rule of thumb is 4%. It also sets your target: yearly expenses &divide; the rate = the nest egg a full retirement needs.') +
                    dt('PAW / AAW / UAW', 'Benchmarks from &ldquo;The Millionaire Next Door&rdquo; for how much wealth your age and income &ldquo;should&rdquo; have produced. AAW (average) = income &times; age &divide; (50 &minus; age); PAW (prodigious) is twice that; UAW (under) is half. The Net Worth chart plots you against all three.') +
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
