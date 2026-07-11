/* UI: LEDGER — a private-wealth statement. Quiet paper, hairline rules,
 * serif verdicts, and an underwriter's stamp. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var charts = { wealth: null, mc: null };
    var els = {};

    var C = {
        deferred: '#A9720F',
        free: '#17604A',
        taxable: '#33608C',
        red: '#A83A31',
        ink: '#1A211D'
    };

    function template() {
        return '' +
        '<div class="lg-shell">' +
            '<header class="lg-masthead">' +
                '<div class="lg-brand">' +
                    '<span class="lg-eyebrow">Private wealth projection</span>' +
                    '<h1>The Coast Ledger</h1>' +
                    '<span class="lg-sub">Tax-deferred &middot; tax-free &middot; after-tax &mdash; one plan, three buckets</span>' +
                '</div>' +
                '<div class="lg-mast-right">' +
                    '<span class="lg-prepared">Prepared ' + FireApp.startYear() + '</span>' +
                    '<button class="lg-reset" type="button">Reset plan</button>' +
                '</div>' +
            '</header>' +

            '<section class="lg-verdicts">' +
                '<article class="lg-verdict" data-v="bridge">' +
                    '<span class="lg-eyebrow">Goal I &mdash; the bridge</span>' +
                    '<span class="lg-v-range" data-el="bridgeRange"></span>' +
                    '<div class="lg-stamp" data-el="bridgeStamp">&mdash;</div>' +
                    '<p class="lg-v-note" data-el="bridgeNote"></p>' +
                '</article>' +
                '<article class="lg-verdict" data-v="coast">' +
                    '<span class="lg-eyebrow">Goal II &mdash; the coast</span>' +
                    '<span class="lg-v-range" data-el="coastRange"></span>' +
                    '<div class="lg-stamp" data-el="coastStamp">&mdash;</div>' +
                    '<p class="lg-v-note" data-el="coastNote"></p>' +
                '</article>' +
                '<article class="lg-verdict" data-v="mc">' +
                    '<span class="lg-eyebrow">Resilience &mdash; Monte Carlo</span>' +
                    '<span class="lg-v-range" data-el="mcSims"></span>' +
                    '<div class="lg-bignum" data-el="mcRate">&mdash;</div>' +
                    '<p class="lg-v-note">of thousands of randomly generated market futures &mdash; booms, crashes and flat decades alike &mdash; leave you with money at 95. ' +
                        'Rather than betting on one average return, it stress-tests your plan against good luck and bad. ' +
                        '<button class="lg-link" type="button" data-el="reroll">Re-roll markets</button></p>' +
                '</article>' +
                '<article class="lg-verdict" data-v="fi">' +
                    '<span class="lg-eyebrow">FI requirement</span>' +
                    '<span class="lg-v-range">Perpetual-growth number</span>' +
                    '<div class="lg-bignum" data-el="fiNumber">&mdash;</div>' +
                    '<p class="lg-v-note">Projected net worth at retirement: <strong data-el="nwAtRetire"></strong></p>' +
                '</article>' +
            '</section>' +

            '<div class="lg-columns">' +
                '<aside class="lg-controls">' +
                    '<div class="lg-panel-title">Plan inputs</div>' +
                    '<div data-el="formGroups"></div>' +
                    '<div class="lg-panel-title">Saving phases</div>' +
                    '<p class="lg-help">How each dollar saved is split between buckets, by age.</p>' +
                    '<div data-el="phases"></div>' +
                    '<div class="lg-panel-title">Drawdown order</div>' +
                    '<p class="lg-help">Which buckets fund each retirement phase.</p>' +
                    '<div data-el="drawdown"></div>' +
                '</aside>' +

                '<main class="lg-main">' +
                    '<section class="lg-panel">' +
                        '<div class="lg-panel-head">' +
                            '<h2>Projected balances</h2>' +
                            '<span class="lg-panel-note">Stacked by bucket &middot; dashed line marks the perpetual FI number</span>' +
                        '</div>' +
                        '<div class="lg-chart"><canvas data-el="wealthChart"></canvas></div>' +
                    '</section>' +

                    '<section class="lg-panel">' +
                        '<div class="lg-panel-head">' +
                            '<h2>Range of outcomes</h2>' +
                            '<span class="lg-panel-note" data-el="mcNote"></span>' +
                        '</div>' +
                        '<div class="lg-chart lg-chart-mc"><canvas data-el="mcChart"></canvas></div>' +
                    '</section>' +

                    '<section class="lg-figures">' +
                        '<div class="lg-figure"><span class="lg-figure-label">Employer match collected</span><span class="lg-figure-val" data-el="figMatch"></span></div>' +
                        '<div class="lg-figure"><span class="lg-figure-label">Taxes paid in retirement</span><span class="lg-figure-val" data-el="figTaxes"></span></div>' +
                        '<div class="lg-figure"><span class="lg-figure-label">Estate at 95</span><span class="lg-figure-val" data-el="figEstate"></span></div>' +
                    '</section>' +

                    '<section class="lg-panel">' +
                        '<div class="lg-panel-head"><h2>Year-by-year statement</h2>' +
                        '<span class="lg-panel-note">Draws are gross of tax</span></div>' +
                        '<div class="lg-tablewrap"><table class="lg-table">' +
                            '<thead><tr>' +
                                '<th>Age</th><th>Year</th><th class="num c-def">Deferred</th><th class="num c-free">Roth</th>' +
                                '<th class="num c-tax">Brokerage</th><th class="num">Total</th><th class="num">Save&nbsp;%</th>' +
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
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        C.ink = dark ? '#E8ECE8' : '#1A211D';
        C.free = dark ? '#8BE8BC' : '#17604A';
        C.deferred = dark ? '#E0AD55' : '#A9720F';
        C.taxable = dark ? '#7FAAD5' : '#33608C';
        C.red = dark ? '#E37C73' : '#A83A31';
        root.innerHTML = template();
        cacheEls(root);

        FireForms.buildGroups(els.formGroups, { collapsed: true, groups: FireSchema.plannerGroups });
        // Keep the first simulation group open
        var first = els.formGroups.querySelector('[data-group="' + FireSchema.plannerGroups[0] + '"]');
        if (first) first.classList.add('open');

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
                ds('Brokerage', C.taxable, 0.45), ds('Roth', C.free, 0.45), ds('Deferred', C.deferred, 0.45),
                { label: 'FI number', data: [], borderColor: C.red, borderWidth: 1.5, borderDash: [6, 5], fill: false, pointRadius: 0, tension: 0 }
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
            fill: true, pointRadius: 0, tension: 0.3, borderWidth: 1.5
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

        els.bridgeRange.textContent = 'Age ' + inp.retireAge + ' → ' + inp.standardRetireAge;
        els.coastRange.textContent = 'Age ' + inp.standardRetireAge + '+';

        if (v.bridge.code === 'na') {
            stamp(els.bridgeStamp, 'na', 'Not needed');
            els.bridgeNote.textContent = 'You retire at or after the standard access age.';
        } else if (v.bridge.code === 'failed') {
            stamp(els.bridgeStamp, 'failed', 'Depleted ' + v.bridge.age);
            els.bridgeNote.textContent = 'The brokerage runs dry at ' + v.bridge.age + '; retirement accounts are tapped early.';
        } else {
            stamp(els.bridgeStamp, 'secure', 'Secure');
            els.bridgeNote.textContent = 'The brokerage carries you to ' + inp.standardRetireAge + ' without touching retirement accounts.';
        }

        if (v.coast.code === 'broke') {
            stamp(els.coastStamp, 'failed', 'Broke at ' + v.coast.age);
            els.coastNote.textContent = 'The portfolio is exhausted before age 95.';
        } else if (v.coast.code === 'secure') {
            stamp(els.coastStamp, 'secure', 'Secure');
            els.coastNote.textContent = 'Tax-advantaged accounts alone cover ' + v.coast.coverage.toFixed(0) + '% of spending at ' + inp.standardRetireAge + '.';
        } else {
            stamp(els.coastStamp, 'partial', v.coast.coverage.toFixed(0) + '% funded');
            els.coastNote.textContent = 'Tax-advantaged accounts fall short at ' + inp.standardRetireAge + '; the whole portfolio carries the load.';
        }

        els.mcRate.textContent = (v.successRate * 100).toFixed(0) + '%';
        els.mcRate.style.color = v.successRate >= 0.8 ? C.free : (v.successRate >= 0.6 ? C.deferred : C.red);
        els.mcSims.textContent = results.mc.sims + ' simulations · σ ' + inp.volatility + '%';

        els.fiNumber.textContent = U.compact(s.fiNumber);
        els.nwAtRetire.textContent = U.money(s.netWorthAtRetirement);

        els.figMatch.textContent = U.money(s.totalMatch);
        els.figTaxes.textContent = U.money(s.totalTaxes);
        els.figEstate.textContent = U.money(s.endingNetWorth);

        els.mcNote.textContent = 'Median estate at 95: ' + U.compact(results.mc.endBalance.p50) +
            ' · worst decile: ' + U.compact(results.mc.endBalance.p10);

        updateCharts(results);
        renderTable(results.sim.rows, inp);
    }

    function updateCharts(results) {
        var rows = results.sim.rows;
        var labels = rows.map(function (r) { return r.age; });
        var swr = FireStore.get().inputs.swr / 100;

        charts.wealth.data.labels = labels;
        charts.wealth.data.datasets[0].data = rows.map(function (r) { return r.taxable; });
        charts.wealth.data.datasets[1].data = rows.map(function (r) { return r.free; });
        charts.wealth.data.datasets[2].data = rows.map(function (r) { return r.deferred; });
        charts.wealth.data.datasets[3].data = rows.map(function (r) { return swr > 0 ? r.expenses / swr : 0; });
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
            if (!r.isRetired) { status = 'Working'; cls = 'st-working'; }
            else if (r.broke) { status = 'Broke'; cls = 'st-broke'; }
            else if (r.phase === 'bridge') { status = 'Bridge'; cls = 'st-bridge'; }
            else { status = 'Retired'; cls = 'st-retired'; }

            var contrib = r.isRetired ? '—'
                : U.compact(r.contrib.deferred + r.contrib.free + r.contrib.taxable) +
                  (r.contrib.match > 0 ? ' <span class="lg-match">+' + U.compact(r.contrib.match) + '</span>' : '');

            html += '<tr class="' + cls + '">' +
                '<td class="num">' + r.age + '</td>' +
                '<td class="num dim">' + r.year + '</td>' +
                '<td class="num c-def">' + U.compact(r.deferred) + '</td>' +
                '<td class="num c-free">' + U.compact(r.free) + '</td>' +
                '<td class="num c-tax">' + U.compact(r.taxable) + '</td>' +
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
