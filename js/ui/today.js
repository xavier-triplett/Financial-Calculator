/* UI: TODAY — a calm, action-oriented home for plan and tracker signals. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var E = global.TrackerEngine;
    var K = global.TrackerKit;
    var els = {};

    function escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function template() {
        return '<div class="home-shell">' +
            '<header class="home-masthead">' +
                '<div><span class="home-eyebrow">Your financial home</span>' +
                    '<h1>Today</h1>' +
                    '<span class="home-sub">One clear view of where you are and what to do next</span></div>' +
                '<div class="home-date">' + new Date().toLocaleDateString(undefined, {
                    weekday: 'long', month: 'long', day: 'numeric'
                }) + '</div>' +
            '</header>' +
            '<div data-el="body"></div>' +
        '</div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = { root: root, body: root.querySelector('[data-el="body"]') };
        root.addEventListener('click', onClick);
    }

    function setupCard(item, done) {
        return '<li class="home-setup-item' + (done ? ' done' : '') + '">' +
            '<span class="home-check" aria-hidden="true">' + (done ? '✓' : '') + '</span>' +
            '<span><strong>' + item.title + '</strong><small>' + item.note + '</small></span></li>';
    }

    function incomplete(readiness, state) {
        var inputs = FireApp.inputs();
        var setup = [
            { done: !!state.profile.birthDate, title: 'Place yourself on the timeline', note: 'Add your date of birth.' },
            { done: Number(inputs.income) > 0 || Number(inputs.currentAge) >= Number(inputs.retireAge),
                title: 'Add what comes in', note: 'Use annual gross income while you are working.' },
            { done: Number(inputs.expenses) > 0, title: 'Add what life costs', note: 'An annual estimate is enough to start.' }
        ];
        var complete = setup.filter(function (item) { return item.done; }).length;
        return '<section class="home-onboard" aria-labelledby="home-start-title">' +
            '<div class="home-onboard-copy">' +
                '<span class="home-kicker">Start with three facts</span>' +
                '<h2 id="home-start-title">No verdict before the basics</h2>' +
                '<p>The app will not call a blank plan “ready.” Add the essentials first, then every projection and tracker comparison will have a real foundation.</p>' +
                '<button class="trk-btn trk-btn-primary" type="button" data-view-target="profile">Finish your profile</button>' +
            '</div>' +
            '<div class="home-setup">' +
                '<div class="home-progress"><span style="width:' + (complete / setup.length * 100) + '%"></span></div>' +
                '<p class="home-progress-label">' + complete + ' of ' + setup.length + ' complete</p>' +
                '<ol>' + setup.map(function (item) { return setupCard(item, item.done); }).join('') + '</ol>' +
            '</div>' +
            '<div class="home-privacy"><strong>Private by default.</strong> Everything works locally. An account is optional, and you can export or delete your data at any time.</div>' +
        '</section>' +
        '<section class="home-first-actions">' +
            '<article><span class="home-step">Then</span><h3>Track your real balances</h3>' +
                '<p>Add accounts and snapshots to see net worth and FI progress without connecting a bank.</p>' +
                '<button class="home-link" type="button" data-view-target="observatory">Open Net Worth →</button></article>' +
            '<article><span class="home-step">Then</span><h3>Understand monthly spending</h3>' +
                '<p>Import a CSV or enter transactions by hand. The Cashbook turns actuals into a review, not a judgment.</p>' +
                '<button class="home-link" type="button" data-view-target="cashbook">Open Cashbook →</button></article>' +
        '</section>';
    }

    function netWorthFacts(state) {
        if (!TrackerStore.hasNetWorth()) return null;
        var series = E.series(state);
        if (!series.netWorth.length) {
            var latest = E.buckets(state);
            return latest ? { value: latest.netWorth, delta: null, label: latest.asOfDate } : null;
        }
        var i = series.netWorth.length - 1;
        var previous = i > 0 ? series.netWorth[i - 1] : null;
        return {
            value: series.netWorth[i],
            delta: previous === null ? null : series.netWorth[i] - previous,
            label: series.months && series.months[i] ? E.monthLabel(String(series.months[i]).slice(0, 7)) : 'Latest snapshot'
        };
    }

    function cashFacts(state) {
        var trailing = E.trailing(state.txns, 12, state.cashMonths);
        if (!trailing) return null;
        return {
            annualExpenses: trailing.annualExpenses,
            monthlyExpenses: trailing.annualExpenses / 12,
            annualSaved: trailing.annualSaved,
            months: trailing.months
        };
    }

    function planStatus() {
        var verdict = FireApp.verdicts();
        if (verdict.coast.code === 'depleted') {
            return { label: 'Needs attention', cls: 'watch', note: 'The current projection depletes at age ' + verdict.coast.age + '.' };
        }
        if (verdict.successRate >= 0.8 && verdict.coast.code === 'secure') {
            return { label: 'On course', cls: 'good', note: Math.round(verdict.successRate * 100) + '% of modeled market paths last through age 95.' };
        }
        if (verdict.successRate >= 0.6) {
            return { label: 'Worth refining', cls: 'steady', note: Math.round(verdict.successRate * 100) + '% of modeled market paths last through age 95.' };
        }
        return { label: 'Build more margin', cls: 'watch', note: Math.round(verdict.successRate * 100) + '% of modeled market paths last through age 95.' };
    }

    function impactHtml(state) {
        var impact = K.planImpact(state);
        if (!impact) {
            return '<p class="home-empty-copy">Track balances or spending to compare your plan with real life.</p>' +
                '<button class="home-link" type="button" data-view-target="cashbook">Add actuals →</button>';
        }
        var age;
        if (impact.retirementAgeDelta === null) {
            age = 'There is not enough margin to estimate a sustainable retirement age from both versions yet.';
        } else if (impact.retirementAgeDelta < 0) {
            age = 'Actuals move the fixed-return retirement estimate about ' + Math.abs(impact.retirementAgeDelta) +
                ' year' + (Math.abs(impact.retirementAgeDelta) === 1 ? '' : 's') + ' earlier.';
        } else if (impact.retirementAgeDelta > 0) {
            age = 'Actuals move the fixed-return retirement estimate about ' + impact.retirementAgeDelta +
                ' year' + (impact.retirementAgeDelta === 1 ? '' : 's') + ' later.';
        } else {
            age = 'The fixed-return retirement estimate is roughly unchanged.';
        }
        var changes = [];
        if (impact.spendingDelta) changes.push((impact.spendingDelta > 0 ? '+' : '−') + U.compact(Math.abs(impact.spendingDelta)) + ' annual spending');
        if (impact.investedDelta) changes.push((impact.investedDelta > 0 ? '+' : '−') + U.compact(Math.abs(impact.investedDelta)) + ' spendable invested');
        return '<p class="home-impact-lead">' + age + '</p>' +
            (changes.length ? '<p class="home-impact-detail">' + changes.join(' · ') + '</p>' : '') +
            '<p class="home-method">A deterministic comparison, not a promise. Review before carrying actuals into your plan.</p>' +
            '<button class="home-link" type="button" data-view-target="' +
                (TrackerStore.hasCash() ? 'cashbook' : 'observatory') + '">Review actuals →</button>';
    }

    function goalsHtml(state) {
        var goals = (state.savingsGoals || []).slice(0, 3);
        if (!goals.length) {
            return '<p class="home-empty-copy">Turn an emergency fund, down payment, or other milestone into a visible target.</p>' +
                '<button class="home-link" type="button" data-view-target="goals">Create a goal →</button>';
        }
        return '<div class="home-goals">' + goals.map(function (goal) {
            var pct = goal.targetAmount > 0 ? Math.max(0, Math.min(100, goal.currentAmount / goal.targetAmount * 100)) : 0;
            return '<div class="home-goal"><div><strong>' + escapeHtml(goal.name) + '</strong>' +
                '<span>' + U.compact(goal.currentAmount) + ' of ' + U.compact(goal.targetAmount) + '</span></div>' +
                '<div class="home-mini-bar"><span style="width:' + pct.toFixed(1) + '%"></span></div></div>';
        }).join('') + '</div><button class="home-link" type="button" data-view-target="goals">Manage goals →</button>';
    }

    function nextMove(state, netWorth, cash) {
        if (!netWorth) {
            return { title: 'Add your first balance snapshot', note: 'A current snapshot unlocks net worth, spendable FI progress, and a plan comparison.', view: 'observatory', action: 'Start Net Worth' };
        }
        if (!cash) {
            return { title: 'Bring in one month of spending', note: 'A CSV import or a few manual entries is enough to begin a monthly review.', view: 'cashbook', action: 'Start Cashbook' };
        }
        if (!(state.budgets || []).length) {
            return { title: 'Give one category a target', note: 'Start with a category that matters. You do not need to budget every dollar.', view: 'goals', action: 'Set a budget' };
        }
        var proposals = K.proposals(state, 'networth').concat(K.proposals(state, 'cashflow'));
        if (proposals.length) {
            return { title: 'Reconcile plan and actuals', note: proposals.length + ' planning input' + (proposals.length === 1 ? '' : 's') + ' differ from tracked reality.', view: 'cashbook', action: 'Review changes' };
        }
        return { title: 'Run your monthly review', note: 'Check balances, spending targets, goals, and the next recurring bills in one pass.', view: 'goals', action: 'Review this month' };
    }

    function complete(state) {
        var inputs = FireApp.inputs();
        var yearsToRetirement = inputs.retireAge - inputs.currentAge;
        var status = planStatus();
        var netWorth = netWorthFacts(state);
        var cash = cashFacts(state);
        var next = nextMove(state, netWorth, cash);
        var target = K.fiTargetToday();
        var invested = K.spendableInvested(state);
        var progress = invested !== null && target > 0 ? invested / target * 100 : null;
        var modelNote = FireApp.isBeginner()
            ? '<div class="home-model-note"><strong>Beginner · no-tax model</strong><span>No income, withdrawal, brokerage, or early-withdrawal taxes are guessed. Switch to Expert when you are ready to supply them.</span></div>'
            : '<div class="home-model-note"><strong>Expert · tax-aware model</strong><span>Results use your tax, return, contribution, and drawdown assumptions.</span></div>';

        return modelNote +
            '<section class="home-hero">' +
                '<div class="home-hero-copy"><span class="home-kicker">Recommended next move</span>' +
                    '<h2>' + next.title + '</h2><p>' + next.note + '</p>' +
                    '<button class="trk-btn trk-btn-primary" type="button" data-view-target="' + next.view + '">' + next.action + '</button></div>' +
                '<div class="home-plan-state ' + status.cls + '"><span>Retirement plan</span><strong>' + status.label + '</strong><small>' + status.note + '</small>' +
                    '<button class="home-link" type="button" data-view-target="ledger">Open Planner →</button></div>' +
            '</section>' +
            '<section class="home-kpis">' +
                '<article><span>Net worth</span><strong>' + (netWorth ? U.compact(netWorth.value) : 'Not tracked') + '</strong>' +
                    '<small>' + (netWorth ? (netWorth.delta === null ? 'First snapshot' :
                        (netWorth.delta >= 0 ? '+' : '−') + U.compact(Math.abs(netWorth.delta)) + ' since prior snapshot') :
                        'Add accounts and a snapshot') + '</small></article>' +
                '<article><span>Monthly spending</span><strong>' + (cash ? U.compact(cash.monthlyExpenses) : 'Not tracked') + '</strong>' +
                    '<small>' + (cash ? 'Average from ' + cash.months + ' month' + (cash.months === 1 ? '' : 's') : 'Import or enter transactions') + '</small></article>' +
                '<article><span>Progress to FI</span><strong>' + (progress === null ? 'Not tracked' : progress.toFixed(1) + '%') + '</strong>' +
                    '<small>' + (progress === null ? 'Needs a balance snapshot' : U.compact(invested) + ' spendable of ' + U.compact(target)) + '</small></article>' +
                '<article><span>Target retirement</span><strong>Age ' + inputs.retireAge + '</strong>' +
                    '<small>' + (yearsToRetirement > 0
                        ? yearsToRetirement + ' year' + (yearsToRetirement === 1 ? '' : 's') + ' from now'
                        : 'at or past this milestone') + '</small></article>' +
            '</section>' +
            '<section class="home-grid">' +
                '<article class="home-panel"><div class="home-panel-head"><h2>Plan vs. actual</h2><span>What changed?</span></div>' +
                    impactHtml(state) + '</article>' +
                '<article class="home-panel"><div class="home-panel-head"><h2>Savings goals</h2><span>' + (state.savingsGoals || []).length + ' active</span></div>' +
                    goalsHtml(state) + '</article>' +
                '<article class="home-panel home-education"><div class="home-panel-head"><h2>Learn in context</h2><span>2 min</span></div>' +
                    '<h3>' + (FireApp.isBeginner() ? 'Why the starter plan skips taxes' : 'Why spendable assets matter') + '</h3>' +
                    '<p>' + (FireApp.isBeginner()
                        ? 'A made-up tax rate creates false precision. The starter model leaves taxes at zero and says so; Expert lets you add rates based on your situation.'
                        : 'A tax-deferred dollar may buy less retirement spending than a Roth dollar. FI progress adjusts each bucket using the rates you entered.') + '</p>' +
                    '<button class="home-link" type="button" data-view-target="guide">Read the guide →</button></article>' +
                '<article class="home-panel home-privacy-card"><div class="home-panel-head"><h2>Data check</h2><span>local-first</span></div>' +
                    '<p>Your full workspace can be downloaded, restored, undone, or deleted from one place.</p>' +
                    '<button class="home-link" type="button" data-view-target="data">Open data controls →</button></article>' +
            '</section>';
    }

    /* Registered as a FireUI, so the state argument is the plan. Every tracker
     * fact below reads TrackerStore directly. */
    function update() {
        var readiness = FireApp.planReadiness();
        els.body.innerHTML = readiness.ready
            ? complete(TrackerStore.get())
            : incomplete(readiness, FireStore.get());
    }

    function onClick(event) {
        var target = event.target.closest('[data-view-target]');
        if (target) FireApp.setView(target.dataset.viewTarget);
    }

    function unmount() { els = {}; }

    (global.FireUIs = global.FireUIs || []).push({
        id: 'today', name: 'Today', tag: 'Your next best financial action',
        mount: mount, update: update, unmount: unmount
    });

})(window);
