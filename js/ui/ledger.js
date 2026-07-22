/* UI: LEDGER — a private-wealth statement. Quiet paper, hairline rules,
 * serif verdicts, and an underwriter's stamp. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var charts = { wealth: null, mc: null };
    var els = {};

    // Filled on mount from TrackerKit's theme-aware palette
    var C = {};

    function template() {
        var beginner = FireApp.mode() === 'beginner';
        return '' +
        '<div class="lg-shell">' +
            '<header class="lg-masthead">' +
                '<div class="lg-brand">' +
                    '<span class="lg-eyebrow">Private wealth projection</span>' +
                    '<h1>The Coast Ledger</h1>' +
                    '<span class="lg-sub" data-el="planPath"></span>' +
                '</div>' +
                '<div class="lg-mast-right">' +
                    '<span class="lg-prepared">Prepared ' + FireApp.startYear() + '</span>' +
                    '<button class="lg-reset" type="button">Reset plan</button>' +
                '</div>' +
            '</header>' +

            '<section class="lg-verdicts">' +
                '<article class="lg-verdict" data-v="bridge">' +
                    '<span class="lg-eyebrow" data-el="firstGoalLabel">Goal I &mdash; the bridge</span>' +
                    '<span class="lg-v-range" data-el="bridgeRange"></span>' +
                    '<div class="lg-stamp" data-el="bridgeStamp">&mdash;</div>' +
                    '<p class="lg-v-note" data-el="bridgeNote"></p>' +
                '</article>' +
                '<article class="lg-verdict" data-v="coast">' +
                    '<span class="lg-eyebrow" data-el="secondGoalLabel">Goal II &mdash; retirement</span>' +
                    '<span class="lg-v-range" data-el="coastRange"></span>' +
                    '<div class="lg-stamp" data-el="coastStamp">&mdash;</div>' +
                    '<p class="lg-v-note" data-el="coastNote"></p>' +
                '</article>' +
                '<article class="lg-verdict" data-v="mc">' +
                    '<span class="lg-eyebrow">' + (beginner ? 'Resilience &mdash; odds it works' : 'Resilience &mdash; Monte Carlo') +
                        '<span class="ff-hint" tabindex="0" role="img" data-tooltip="Rather than betting on one average return, your plan is re-run against randomly generated market futures &mdash; booms, crashes and flat decades alike. The rate is the share that still has money at 95." ' +
                            'aria-label="Rather than betting on one average return, your plan is re-run against randomly generated market futures. The rate is the share that still has money at 95.">i</span></span>' +
                    '<span class="lg-v-range lg-expert" data-el="mcSims"></span>' +
                    '<div class="lg-bignum" data-el="mcRate">&mdash;</div>' +
                    '<p class="lg-v-note">of simulated market futures leave you with money at 95. ' +
                        '<button class="lg-link lg-expert" type="button" data-el="reroll">Re-roll markets</button></p>' +
                '</article>' +
                '<article class="lg-verdict" data-v="fi">' +
                    '<span class="lg-eyebrow">' + (beginner ? 'Your coast number' : 'Coast number today') + '</span>' +
                    '<span class="lg-v-range">No new savings &rarr; account unlock</span>' +
                    '<div class="lg-bignum" data-el="fiNumber">&mdash;</div>' +
                    '<p class="lg-v-note">Full target at unlock: <strong data-el="fiTarget"></strong><br>Tax-adjusted coast balance: <strong data-el="nwAtRetire"></strong></p>' +
                '</article>' +
            '</section>' +

            '<p class="lg-infeasible" data-el="infeasible" hidden></p>' +

            '<div class="lg-columns">' +
                '<aside class="lg-controls">' +
                    '<div class="lg-panel-title">Plan inputs</div>' +
                    '<div data-el="formGroups"></div>' +
                    '<div class="lg-panel-title lg-expert">Saving phases</div>' +
                    '<p class="lg-help lg-expert">How each dollar saved is split between buckets, by age.</p>' +
                    '<div class="lg-expert" data-el="phases"></div>' +
                    '<div class="lg-panel-title lg-expert">Drawdown order</div>' +
                    '<p class="lg-help lg-expert">Which buckets fund each retirement phase.</p>' +
                    '<div class="lg-expert" data-el="drawdown"></div>' +
                    '<p class="mode-note" data-el="assumptions"' + (beginner ? '' : ' hidden') + '></p>' +
                '</aside>' +

                '<main class="lg-main">' +
                    '<section class="lg-panel">' +
                        '<div class="lg-panel-head">' +
                            '<h2>Projected balances</h2>' +
                            '<span class="lg-panel-note">Stacked by bucket &middot; dashed line marks ' + (beginner ? 'your target number' : 'the perpetual FI number') + '</span>' +
                        '</div>' +
                        '<div class="lg-chart"><canvas data-el="wealthChart" role="img" aria-label="Projected balances chart" aria-describedby="wealth-chart-summary"></canvas></div>' +
                        '<p class="sr-only" id="wealth-chart-summary" data-el="wealthSummary"></p>' +
                    '</section>' +

                    '<section class="lg-panel lg-expert">' +
                        '<div class="lg-panel-head">' +
                            '<h2>Range of outcomes</h2>' +
                            '<span class="lg-panel-note" data-el="mcNote"></span>' +
                        '</div>' +
                        '<div class="lg-chart lg-chart-mc"><canvas data-el="mcChart" role="img" aria-label="Range of outcomes chart" aria-describedby="mc-chart-summary"></canvas></div>' +
                        '<p class="sr-only" id="mc-chart-summary" data-el="mcSummary"></p>' +
                    '</section>' +

                    '<section class="lg-figures lg-expert">' +
                        '<div class="lg-figure"><span class="lg-figure-label">Employer match collected</span><span class="lg-figure-val" data-el="figMatch"></span></div>' +
                        '<div class="lg-figure"><span class="lg-figure-label">Taxes paid in retirement</span><span class="lg-figure-val" data-el="figTaxes"></span></div>' +
                        '<div class="lg-figure"><span class="lg-figure-label">Estate at 95</span><span class="lg-figure-val" data-el="figEstate"></span></div>' +
                    '</section>' +

                    '<section class="lg-panel lg-expert">' +
                        '<div class="lg-panel-head"><h2>Year-by-year statement</h2>' +
                        '<span class="lg-panel-note">Draws are gross of tax</span></div>' +
                        '<div class="lg-tablewrap"><table class="lg-table">' +
                            '<thead><tr>' +
                                '<th>Age</th><th>Year</th><th class="num c-def">Deferred</th><th class="num c-free">Roth</th>' +
                                '<th class="num c-tax">Brokerage</th><th class="num c-cash">Cash</th><th class="num">Total</th><th class="num">Save&nbsp;%</th>' +
                                '<th class="num">Contribution</th><th class="num">Draw</th><th class="num">Tax</th>' +
                                '<th>Status</th>' +
                            '</tr></thead>' +
                            '<tbody data-el="tbody"></tbody>' +
                        '</table></div>' +
                    '</section>' +
                '</main>' +
            '</div>' +
        '</div>';
    }

    function cacheEls(root) {
        els = {};
        root.querySelectorAll('[data-el]').forEach(function (n) { els[n.getAttribute('data-el')] = n; });
        els.root = root;
    }

    function stamp(el, code, label) {
        el.textContent = label;
        el.className = 'lg-stamp lg-stamp-' + code;
    }

    function mount(root) {
        var P = global.TrackerKit.PALETTE;
        C.ink = P.ink;
        C.free = P.taxFree;
        C.deferred = P.taxDeferred;
        C.taxable = P.afterTax;
        C.cash = P.cash;
        C.red = P.liability;
        root.innerHTML = template();
        cacheEls(root);

        FireForms.buildGroups(els.formGroups, { collapsed: true, groups: FireSchema.plannerGroups });
        // Keep the first simulation group open
        var first = els.formGroups.querySelector('[data-group="' + FireSchema.plannerGroups[0] + '"]');
        if (first) FireForms.setGroupOpen(first, true);

        root.querySelector('.lg-reset').addEventListener('click', FireApp.confirmReset);
        els.reroll.addEventListener('click', function () { FireStore.rerollSeed(); });

        makeCharts();
    }

    function makeCharts() {
        var fontMono = { family: "'IBM Plex Mono', monospace", size: 10 };
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        var gridColor = dark
            ? 'rgba(232,236,232,0.09)' : 'rgba(26,33,29,0.07)';
        var bandLine = dark ? 'rgba(139,232,188,0.55)' : 'rgba(23,96,74,0.35)';
        var bandFill = dark ? 'rgba(139,232,188,0.14)' : 'rgba(23,96,74,0.10)';

        charts.wealth = new Chart(els.wealthChart.getContext('2d'), {
            type: 'line',
            data: { labels: [], datasets: [
                ds('Cash', C.cash, 0.4), ds('Brokerage', C.taxable, 0.45), ds('Roth', C.free, 0.45), ds('Deferred', C.deferred, 0.45),
                // Own stack group so the threshold line stays at its raw value
                // instead of stacking on top of the buckets.
                { label: 'FI number', data: [], borderColor: C.red, borderWidth: 1.5, borderDash: [6, 5], fill: false, pointRadius: 0, tension: 0, stack: 'fi' }
            ]},
            options: chartOpts(fontMono, gridColor, true)
        });

        charts.mc = new Chart(els.mcChart.getContext('2d'), {
            type: 'line',
            data: { labels: [], datasets: [
                { label: '90th percentile', data: [], borderColor: bandLine, borderWidth: 1, fill: false, pointRadius: 0, tension: 0.3 },
                { label: '10th–90th range', data: [], borderColor: bandLine, borderWidth: 1, backgroundColor: bandFill, fill: '-1', pointRadius: 0, tension: 0.3 },
                { label: 'Median outcome', data: [], borderColor: C.free, borderWidth: 2, fill: false, pointRadius: 0, tension: 0.3 },
                { label: 'Fixed-return plan', data: [], borderColor: C.ink, borderWidth: 1.2, borderDash: [3, 4], fill: false, pointRadius: 0, tension: 0.3 }
            ]},
            options: chartOpts(fontMono, gridColor, false)
        });
    }

    function ds(label, color, alpha) {
        return {
            label: label, data: [],
            borderColor: color,
            backgroundColor: hexAlpha(color, alpha),
            fill: true, pointRadius: 0, tension: 0.3, borderWidth: 1.5, stack: 'buckets'
        };
    }

    function hexAlpha(hex, a) {
        var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    function chartOpts(font, gridColor, stacked) {
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        var muted = dark ? '#A4AFA8' : '#66716B';
        var legend = dark ? '#C8D0CB' : '#424C46';
        return {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { ticks: { font: font, color: muted, maxTicksLimit: 14 }, grid: { display: false } },
                y: {
                    stacked: stacked,
                    ticks: { font: font, color: muted, callback: function (v) { return U.compact(v); } },
                    grid: { color: gridColor }
                }
            },
            plugins: {
                legend: { labels: { font: { family: "'Public Sans', sans-serif", size: 11 }, color: legend, boxWidth: 10, boxHeight: 10 } },
                tooltip: {
                    backgroundColor: '#1A211D', titleFont: font, bodyFont: font, padding: 10, cornerRadius: 4,
                    callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + U.money(c.parsed.y); } }
                }
            }
        };
    }

    function update(state, results) {
        FireForms.syncInputs(els.root);
        FireForms.renderPhases(els.phases);
        FireForms.renderDrawdown(els.drawdown);

        var s = results.sim.summary;
        var v = FireApp.verdicts();
        var inp = state.inputs;
        var plan = FireSchema.planType(inp.planType);
        var coastPlan = inp.planType === FireEngine.PLAN_TYPES.COAST;
        var earlyPlan = inp.planType === FireEngine.PLAN_TYPES.EARLY;

        els.planPath.textContent = plan.name + ' · tax-deferred · tax-free · after-tax';

        if (coastPlan) {
            els.firstGoalLabel.textContent = 'Milestone I — reach the coast';
            els.bridgeRange.textContent = 'Now → Age ' + s.coastStartAge;
            if (s.coastCoverageAtStart >= 100) {
                stamp(els.bridgeStamp, 'secure', 'Ready');
                els.bridgeNote.textContent = 'Projected retirement balance at coast: ' + U.compact(s.coastBalanceAtStart) +
                    ' against a ' + U.compact(s.coastTargetAtStart) + ' target.';
            } else {
                stamp(els.bridgeStamp, 'partial', s.coastCoverageAtStart.toFixed(0) + '% funded');
                els.bridgeNote.textContent = 'At age ' + s.coastStartAge + ', projected retirement accounts are ' +
                    U.compact(s.coastBalanceAtStart) + '; the coast target is ' + U.compact(s.coastTargetAtStart) + '.';
            }
        } else if (earlyPlan) {
            els.firstGoalLabel.textContent = 'Goal I — the bridge';
            els.bridgeRange.textContent = 'Age ' + inp.retireAge + ' → ' + inp.standardRetireAge;
            if (v.bridge.code === 'na') {
                stamp(els.bridgeStamp, 'na', 'Not needed');
                els.bridgeNote.textContent = 'You retire at or after the standard access age.';
            } else if (v.bridge.code === 'failed') {
                stamp(els.bridgeStamp, 'failed', 'Depleted ' + v.bridge.age);
                els.bridgeNote.textContent = 'The brokerage runs dry at ' + v.bridge.age + '; retirement accounts are tapped early.';
            } else {
                stamp(els.bridgeStamp, 'secure', 'Secure');
                els.bridgeNote.textContent = 'The plan carries spending to account access at ' + inp.standardRetireAge + '.';
            }
        } else {
            els.firstGoalLabel.textContent = 'Milestone I — retirement readiness';
            els.bridgeRange.textContent = 'Now → Age ' + inp.retireAge;
            if (s.retirementCoverageAtReadiness >= 100) {
                stamp(els.bridgeStamp, 'secure', 'Ready');
                els.bridgeNote.textContent = 'The projected after-tax portfolio is ' + U.compact(s.retirementBalanceAtReadiness) +
                    ' against a ' + U.compact(s.fiNumberAtUnlock) + ' retirement target.';
            } else {
                stamp(els.bridgeStamp, 'partial', s.retirementCoverageAtReadiness.toFixed(0) + '% funded');
                els.bridgeNote.textContent = 'The current saving path falls short of the retirement checkpoint.';
            }
        }

        if (s.firstInfeasibleAge !== null) {
            els.infeasible.hidden = false;
            els.infeasible.textContent = 'Feasibility: from age ' + s.firstInfeasibleAge +
                ', planned saving plus spending exceeds take-home pay (gross income less the effective income tax on the Profile tab). ' +
                'Saving is capped to the available take-home surplus; lower the requested savings rate or spending to remove this constraint.';
        } else {
            els.infeasible.hidden = true;
        }

        els.secondGoalLabel.textContent = coastPlan ? 'Milestone II — coast to retirement' :
            (earlyPlan ? 'Goal II — long retirement' : 'Milestone II — retirement runway');
        els.coastRange.textContent = coastPlan ? 'Age ' + s.coastStartAge + ' → ' + inp.retireAge :
            'Age ' + Math.max(inp.retireAge, inp.standardRetireAge) + ' → 95';

        if (!coastPlan && !earlyPlan && s.ranOutOfMoneyAge === null) {
            stamp(els.coastStamp, 'secure', 'Funded');
            els.coastNote.textContent = 'The fixed-return projection funds retirement spending through age 95.';
        } else if (v.coast.code === 'broke') {
            stamp(els.coastStamp, 'failed', 'Broke at ' + v.coast.age);
            els.coastNote.textContent = 'The portfolio is exhausted before age 95.';
        } else if (v.coast.code === 'secure') {
            stamp(els.coastStamp, 'secure', coastPlan ? 'On course' : 'Secure');
            els.coastNote.textContent = coastPlan
                ? 'From age ' + s.coastStartAge + ', contributions stop while existing retirement balances keep growing. Full retirement begins at ' + inp.retireAge + '.'
                : 'Tax-advantaged accounts cover ' + v.coast.coverage.toFixed(0) + '% of spending at age ' + s.readinessAge + '.';
        } else {
            stamp(els.coastStamp, 'partial', v.coast.coverage.toFixed(0) + '% funded');
            els.coastNote.textContent = coastPlan
                ? 'Growth alone does not reach the full retirement target; adjust the coast age, retirement age, or spending.'
                : 'Tax-advantaged accounts fall short at age ' + s.readinessAge + '; the whole portfolio carries the load.';
        }

        els.mcRate.textContent = (v.successRate * 100).toFixed(0) + '%';
        els.mcRate.style.color = v.successRate >= 0.8 ? C.free : (v.successRate >= 0.6 ? C.deferred : C.red);
        els.mcSims.textContent = results.mc.sims + ' simulations · σ ' + inp.volatility + '%';

        els.fiNumber.textContent = U.compact(s.coastNumber);
        els.fiTarget.textContent = U.compact(s.fiNumberAtUnlock);
        els.nwAtRetire.textContent = U.money(s.coastBalanceToday);

        if (FireApp.mode() === 'beginner') {
            els.assumptions.innerHTML = FireSchema.assumptionsText(state) +
                ' <button type="button" data-mode-set="expert">Open Expert mode</button> to change them.';
        }

        els.figMatch.textContent = U.money(s.totalMatch);
        els.figTaxes.textContent = U.money(s.totalTaxes);
        els.figEstate.textContent = U.money(s.endingNetWorth);

        els.mcNote.textContent = 'Median estate at 95: ' + U.compact(results.mc.endBalance.p50) +
            ' · worst decile: ' + U.compact(results.mc.endBalance.p10);

        var finalRow = results.sim.rows[results.sim.rows.length - 1];
        els.wealthSummary.textContent = 'Projected balances from age ' + inp.currentAge + ' through 95. ' +
            'The fixed-return projection ends with ' + U.money(finalRow ? finalRow.total : 0) + '.';
        els.mcSummary.textContent = Math.round(v.successRate * 100) + ' percent of ' + results.mc.sims +
            ' simulated market paths retain money through age 95. Median ending balance: ' +
            U.money(results.mc.endBalance.p50) + '.';

        updateCharts(results);
        renderTable(results.sim.rows, inp);
    }

    function updateCharts(results) {
        var rows = results.sim.rows;
        var labels = rows.map(function (r) { return r.age; });
        var swr = FireStore.get().inputs.swr / 100;

        charts.wealth.data.labels = labels;
        charts.wealth.data.datasets[0].data = rows.map(function (r) { return r.cash; });
        charts.wealth.data.datasets[1].data = rows.map(function (r) { return r.taxable; });
        charts.wealth.data.datasets[2].data = rows.map(function (r) { return r.free; });
        charts.wealth.data.datasets[3].data = rows.map(function (r) { return r.deferred; });
        charts.wealth.data.datasets[4].data = rows.map(function (r) { return swr > 0 ? r.expenses / swr : 0; });
        charts.wealth.update('none');

        var b = results.mc.bands;
        charts.mc.data.labels = b.ages;
        charts.mc.data.datasets[0].data = b.p90;
        charts.mc.data.datasets[1].data = b.p10;
        charts.mc.data.datasets[2].data = b.p50;
        charts.mc.data.datasets[3].data = rows.map(function (r) { return r.total; });
        charts.mc.update('none');
    }

    function renderTable(rows, inp) {
        var html = '';
        rows.forEach(function (r) {
            var status, cls;
            if (r.phase === 'coasting') { status = 'Coasting'; cls = 'st-coasting'; }
            else if (!r.isRetired) { status = 'Working'; cls = 'st-working'; }
            else if (r.broke) { status = 'Broke'; cls = 'st-broke'; }
            else if (r.phase === 'bridge') { status = 'Bridge'; cls = 'st-bridge'; }
            else { status = 'Retired'; cls = 'st-retired'; }

            var contrib = r.isRetired || r.phase === 'coasting' ? '—'
                : U.compact(r.contrib.deferred + r.contrib.free + r.contrib.taxable) +
                  (r.contrib.match > 0 ? ' <span class="lg-match">+' + U.compact(r.contrib.match) + '</span>' : '');

            html += '<tr class="' + cls + '">' +
                '<td class="num">' + r.age + '</td>' +
                '<td class="num dim">' + r.year + '</td>' +
                '<td class="num c-def">' + U.compact(r.deferred) + '</td>' +
                '<td class="num c-free">' + U.compact(r.free) + '</td>' +
                '<td class="num c-tax">' + U.compact(r.taxable) + '</td>' +
                '<td class="num c-cash dim">' + U.compact(r.cash) + '</td>' +
                '<td class="num strong">' + U.compact(r.total) + '</td>' +
                '<td class="num dim">' + (r.isRetired ? '—' : (r.savingsRate * 100).toFixed(1) + '%') + '</td>' +
                '<td class="num">' + contrib + '</td>' +
                '<td class="num">' + (r.wd.gross > 0 ? U.compact(r.wd.gross) : '—') + '</td>' +
                '<td class="num dim">' + (r.wd.taxes > 0 ? U.compact(r.wd.taxes) : '—') + '</td>' +
                '<td><span class="lg-status ' + cls + '">' + status + '</span></td>' +
            '</tr>';
        });
        els.tbody.innerHTML = html;
    }

    function unmount() {
        if (charts.wealth) { charts.wealth.destroy(); charts.wealth = null; }
        if (charts.mc) { charts.mc.destroy(); charts.mc = null; }
    }

    (global.FireUIs = global.FireUIs || []).push({
        id: 'ledger', name: 'Planner', tag: 'A private-wealth statement',
        mount: mount, update: update, unmount: unmount
    });

})(window);
