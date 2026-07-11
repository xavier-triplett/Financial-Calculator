/* UI: OBSERVATORY — net worth, and nothing else. The headline chart plots
 * net worth against the workbook's PAW / AAW / UAW accumulator benchmarks;
 * composition gets its own chart; every month's balances are edited in
 * place in the ruled grid below. No CSV import here — numbers are typed. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var E = global.TrackerEngine;
    var K = global.TrackerKit;
    var charts = { bench: null, comp: null };
    var els = {};

    function template() {
        return '' +
        '<div class="trk-shell">' +
            '<header class="trk-masthead">' +
                '<div>' +
                    '<span class="trk-eyebrow">Net worth · actuals</span>' +
                    '<h1>The Observatory</h1>' +
                    '<span class="trk-sub">Net worth over time, measured against the accumulator benchmarks</span>' +
                '</div>' +
                '<div class="trk-mast-actions" data-el="actions"></div>' +
            '</header>' +
            '<div data-el="body"></div>' +
        '</div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = { root: root, body: root.querySelector('[data-el="body"]'), actions: root.querySelector('[data-el="actions"]') };

        var addMonth = U.el('button', { class: 'trk-btn trk-btn-primary', type: 'button', text: '+ Month' });
        addMonth.addEventListener('click', function () { TrackerStore.addMonth(); });
        els.actions.appendChild(addMonth);
        var clear = U.el('button', { class: 'trk-btn trk-btn-danger', type: 'button', text: 'Clear net worth' });
        clear.addEventListener('click', function () {
            FireApp.confirm('Clear all tracked data (net worth and cashbook)?', function () {
                TrackerStore.reset();
                FireApp.toast('Tracked data cleared');
            }, 'Clear data');
        });
        els.actions.appendChild(clear);
    }

    function editingInput(container) {
        var a = document.activeElement;
        return a && a.tagName === 'INPUT' && container && container.contains(a) ? a : null;
    }

    function profileSummary(state) {
        var p = K.sharedProfile();
        var months = Object.keys(state.snapshots).sort();
        var latest = months[months.length - 1];
        var eff = latest ? E.ageIncomeAt(state, latest, p) : null;
        if (!eff) {
            return 'Set your date of birth &amp; income on the <strong>Profile</strong> tab to draw the PAW / AAW / UAW lines.';
        }
        var rec = (state.ageIncome || {})[latest];
        var source = rec && rec.income !== undefined
            ? 'recorded on the grid&rsquo;s income row'
            : Object.keys(state.ageIncome || {}).some(function (k) { return k < latest && (state.ageIncome[k] || {}).income !== undefined; })
                ? 'carried forward on the grid&rsquo;s income row'
                : 'from the <strong>Profile</strong> tab';
        return E.monthLabel(latest) + ': age ' + eff.age + ' · income ' + U.compact(eff.income) + ', ' + source +
            '. Record a change in the month it lands; blank months inherit.';
    }

    /* ---------------- KPIs ---------------- */
    function kpi(label, value, note, cls) {
        return '<article class="trk-kpi"><span class="trk-eyebrow">' + label + '</span>' +
            '<div class="trk-kpi-val ' + (cls || '') + '">' + value + '</div>' +
            '<p class="trk-kpi-note">' + note + '</p></article>';
    }

    function wealthVerdict(nw, bench) {
        if (!bench) return { label: '—', cls: '', note: 'Set your date of birth & income on the Profile tab to place yourself.' };
        var note = 'UAW ' + U.compact(bench.uaw) + ' · AAW ' + U.compact(bench.aaw) + ' · PAW ' + U.compact(bench.paw);
        if (nw >= bench.paw) return { label: 'PAW', cls: 'pos', note: 'Prodigious accumulator — above 2× expected. ' + note };
        if (nw >= bench.aaw) return { label: 'Above AAW', cls: 'pos', note: 'Ahead of the average accumulator. ' + note };
        if (nw >= bench.uaw) return { label: 'Below AAW', cls: '', note: 'Between under- and average accumulator. ' + note };
        return { label: 'UAW', cls: 'neg', note: 'Under-accumulator — below half of expected. ' + note };
    }

    function kpisHTML(state, s) {
        var n = s.months.length;
        var nw = n ? s.netWorth[n - 1] : 0;
        var d1 = n > 1 ? nw - s.netWorth[n - 2] : null;
        var d12 = n > 12 ? nw - s.netWorth[n - 13] : (n > 1 ? nw - s.netWorth[0] : null);
        var ctx = K.planContext();
        var fiPct = n && ctx.fiNumber > 0 ? (s.investable[n - 1] / ctx.fiNumber) * 100 : null;
        var ai = n ? E.ageIncomeAt(state, s.months[n - 1], K.sharedProfile()) : null;
        var verdict = wealthVerdict(nw, ai && E.benchmarks(ai.age, ai.income));

        var html = '<section class="trk-kpis" data-el="kpis-inner">';
        html += kpi('Net worth', n ? U.compact(nw) : '—',
            d1 === null ? 'first tracked month' :
                (d1 >= 0 ? '+' : '') + U.compact(d1) + ' this month · ' +
                (d12 !== null ? (d12 >= 0 ? '+' : '') + U.compact(d12) + ' over the year' : ''),
            d1 !== null && d1 < 0 ? 'neg' : '');
        html += kpi('Investable', n ? U.compact(s.investable[n - 1]) : '—',
            n ? 'against ' + U.compact(s.liabilities[n - 1]) + ' of liabilities' : 'no months yet');
        html += kpi('Accumulator', verdict.label, verdict.note, verdict.cls);
        html += kpi('Progress to FI', fiPct === null ? '—' : fiPct.toFixed(1) + '%',
            fiPct === null ? 'the planner sets the target' :
                U.compact(s.investable[n - 1]) + ' investable of ' + U.compact(ctx.fiNumber) + ' · plan retires at ' + ctx.retireAge);
        return html + '</section>';
    }

    /* ---------------- render ---------------- */
    function update(state) {
        if (!TrackerStore.hasNetWorth()) {
            destroyCharts();
            els.body.innerHTML = '';
            var start = U.el('button', { class: 'trk-btn trk-btn-primary', type: 'button', text: 'Start first month' });
            start.addEventListener('click', function () { TrackerStore.addMonth(); });
            els.body.appendChild(K.emptyState('An empty balance sheet',
                'Start a month and add accounts to the grid, or seed everything from your config file.',
                [start, K.seedButton()]));
            return;
        }

        // While typing in the grid, refresh derived cells and charts in place.
        var focused = editingInput(els.body.querySelector('[data-el="grid"]'));
        if (focused) { syncDerived(state); return; }

        var s = E.series(state);
        destroyCharts();
        els.body.innerHTML =
            '<div data-el="kpis">' + kpisHTML(state, s) + '</div>' +
            '<section class="trk-panel">' +
                '<div class="trk-panel-head"><h2>Net worth vs. the benchmarks</h2>' +
                '<span class="trk-panel-note">PAW &middot; AAW &middot; UAW &mdash; expected accumulation for your age and income</span></div>' +
                '<div class="trk-chart trk-chart-tall"><canvas data-el="benchChart"></canvas></div>' +
            '</section>' +
            '<div class="trk-obs-grid">' +
                '<section class="trk-panel trk-obs-main">' +
                    '<div class="trk-panel-head"><h2>Composition</h2>' +
                    '<span class="trk-panel-note">Assets stacked by group &middot; liabilities dashed</span></div>' +
                    '<div class="trk-chart"><canvas data-el="compChart"></canvas></div>' +
                '</section>' +
                '<aside class="trk-obs-side">' +
                    '<section class="trk-panel">' +
                        '<div class="trk-panel-head"><h2>Benchmark profile</h2></div>' +
                        '<p class="trk-kpi-note" style="margin:0">' + profileSummary(state) + '</p>' +
                    '</section>' +
                    '<section class="trk-panel trk-bridge" data-el="bridge"></section>' +
                '</aside>' +
            '</div>' +
            '<section class="trk-panel">' +
                '<div class="trk-panel-head"><h2>The months</h2>' +
                '<span class="trk-panel-note">Edit any cell &middot; new months carry the prior balance forward</span></div>' +
                '<div class="trk-gridwrap" data-el="grid">' + gridHTML(state, s) + '</div>' +
            '</section>';

        wireGrid();
        K.renderBridge(els.body.querySelector('[data-el="bridge"]'), state, { scope: 'networth', fi: true });
        makeCharts(state, s);
    }

    /* ---------------- editable months grid ---------------- */
    function gridHTML(state, s) {
        var months = s.months;

        var head = '<tr><th class="trk-sticky">Account</th>';
        months.forEach(function (mo) {
            head += '<th class="num">' + E.monthLabel(mo, true) +
                '<button class="trk-x" data-del-month="' + mo + '" title="Remove month">&times;</button></th>';
        });
        head += '</tr>';

        var body = '';
        E.GROUPS.forEach(function (g) {
            var accts = state.accounts.filter(function (a) { return a.group === g.id; });
            body += '<tr class="trk-grouprow"><td class="trk-sticky">' + g.label +
                ' <button class="trk-mini" data-add-acct="' + g.id + '">+ account</button></td>' +
                '<td colspan="' + months.length + '"></td></tr>';
            accts.forEach(function (a) {
                body += '<tr><td class="trk-sticky trk-acctcell">' +
                    '<input class="trk-acct-name" value="' + escapeAttr(a.name) + '" data-rename="' + a.id + '">' +
                    '<button class="trk-x" data-del-acct="' + a.id + '" title="Remove account">&times;</button></td>';
                months.forEach(function (mo) {
                    var v = state.snapshots[mo][a.id];
                    body += '<td class="num"><input class="trk-cell" type="text" inputmode="numeric" value="' +
                        (v === undefined ? '' : Math.round(v)) + '" data-month="' + mo + '" data-acct="' + a.id + '"></td>';
                });
                body += '</tr>';
            });
            if (accts.length && g.id !== 'liability') {
                body += '<tr class="trk-subtotal"><td class="trk-sticky">Total ' + g.label.toLowerCase() + '</td>';
                months.forEach(function (mo, i) {
                    body += '<td class="num" data-sub="' + g.id + ':' + i + '">' + U.compact(s.byGroup[g.id][i]) + '</td>';
                });
                body += '</tr>';
            }
        });

        body += totalRow('Total assets', s.assets, 'assets');
        body += totalRow('Total liabilities', s.liabilities, 'liab');
        body += totalRow('Net worth', s.netWorth, 'nw', 'trk-nwrow');
        var deltas = s.netWorth.map(function (v, i) { return i === 0 ? null : v - s.netWorth[i - 1]; });
        body += '<tr class="trk-deltarow"><td class="trk-sticky">Change</td>' + deltas.map(function (d, i) {
            return '<td class="num ' + (d > 0 ? 'pos' : d < 0 ? 'neg' : '') + '" data-sub="delta:' + i + '">' +
                (d === null ? '—' : (d > 0 ? '+' : '') + U.compact(d)) + '</td>';
        }).join('') + '</tr>';

        // Benchmark income: record a raise in the month it lands; blank
        // months inherit from the last recorded month or the Profile tab.
        var profile = K.sharedProfile();
        body += '<tr class="trk-incomerow"><td class="trk-sticky">Annual income' +
            ' <span class="ff-hint" tabindex="0" role="img" data-tooltip="Gross annual income used for the PAW / AAW / UAW benchmarks. Type it in the month it changes; blank months inherit from the last recorded month, or the Profile tab.">i</span></td>';
        months.forEach(function (mo) {
            var rec = (state.ageIncome || {})[mo];
            var eff = E.ageIncomeAt(state, mo, profile);
            body += '<td class="num"><input class="trk-cell trk-income" type="text" inputmode="numeric" value="' +
                (rec && rec.income !== undefined ? Math.round(rec.income) : '') +
                '" placeholder="' + (eff ? U.moneyStr(eff.income, true) : '—') + '" data-income-month="' + mo + '"></td>';
        });
        body += '</tr>';

        return '<table class="trk-grid"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    }

    function totalRow(label, arr, key, cls) {
        var html = '<tr class="trk-total ' + (cls || '') + '"><td class="trk-sticky">' + label + '</td>';
        arr.forEach(function (v, i) { html += '<td class="num" data-sub="' + key + ':' + i + '">' + U.compact(v) + '</td>'; });
        return html + '</tr>';
    }

    function wireGrid() {
        var grid = els.body.querySelector('[data-el="grid"]');
        grid.addEventListener('change', function (e) {
            var t = e.target;
            if (t.dataset.month) TrackerStore.setBalance(t.dataset.month, t.dataset.acct, U.parseNum(t.value));
            else if (t.dataset.incomeMonth) TrackerStore.setAgeIncome(t.dataset.incomeMonth, U.parseNum(t.value));
            else if (t.dataset.rename) TrackerStore.renameAccount(t.dataset.rename, t.value);
        });
        grid.querySelectorAll('.trk-cell').forEach(function (c) { U.bindCurrency(c, { prefix: true }); });
        grid.addEventListener('click', function (e) {
            var t = e.target;
            if (t.dataset.addAcct) {
                var group = t.dataset.addAcct;
                FireApp.prompt('New account name', function (name) {
                    if (name && name.trim()) TrackerStore.addAccount(name.trim(), group);
                }, 'Add account', 'e.g. Brokerage');
            } else if (t.dataset.delAcct) {
                FireApp.confirm('Remove this account and its history?', function () {
                    TrackerStore.removeAccount(t.dataset.delAcct);
                    FireApp.toast('Account deleted');
                });
            } else if (t.dataset.delMonth) {
                FireApp.confirm('Remove ' + E.monthLabel(t.dataset.delMonth) + '?', function () {
                    TrackerStore.removeMonth(t.dataset.delMonth);
                    FireApp.toast('Month deleted');
                });
            }
        });
        grid.scrollLeft = grid.scrollWidth; // land on the latest months
    }

    /* Refresh derived cells, KPIs and charts in place while typing. */
    function syncDerived(state) {
        var s = E.series(state);
        var lookup = { assets: s.assets, liab: s.liabilities, nw: s.netWorth };
        els.body.querySelectorAll('[data-sub]').forEach(function (td) {
            var p = td.getAttribute('data-sub').split(':');
            var i = Number(p[1]);
            var v;
            if (p[0] === 'delta') {
                v = i === 0 ? null : s.netWorth[i] - s.netWorth[i - 1];
                td.textContent = v === null ? '—' : (v > 0 ? '+' : '') + U.compact(v);
                td.className = 'num ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
                return;
            }
            v = lookup[p[0]] ? lookup[p[0]][i] : s.byGroup[p[0]][i];
            td.textContent = U.compact(v);
        });
        var kpis = els.body.querySelector('[data-el="kpis"]');
        if (kpis) kpis.innerHTML = kpisHTML(state, s);
        feedCharts(state, s);
    }

    /* ---------------- charts ---------------- */
    function makeCharts(state, s) {
        charts.bench = new Chart(els.body.querySelector('[data-el="benchChart"]').getContext('2d'), {
            type: 'line',
            data: { labels: [], datasets: [
                { label: 'Net worth', data: [], borderColor: K.PALETTE.ink, backgroundColor: K.alpha(K.PALETTE.ink, 0.05), borderWidth: 2.4, fill: true, pointRadius: 0, tension: 0.3 },
                { label: 'PAW (2× expected)', data: [], borderColor: K.PALETTE.taxFree, borderWidth: 1.4, borderDash: [7, 4], fill: false, pointRadius: 0, tension: 0.3 },
                { label: 'AAW (expected)', data: [], borderColor: K.PALETTE.taxDeferred, borderWidth: 1.4, borderDash: [7, 4], fill: false, pointRadius: 0, tension: 0.3 },
                { label: 'UAW (½ expected)', data: [], borderColor: K.PALETTE.liability, borderWidth: 1.4, borderDash: [7, 4], fill: false, pointRadius: 0, tension: 0.3 }
            ]},
            options: K.chartOpts({ plugins: { tooltip: { itemSort: function (a, b) { return b.parsed.y - a.parsed.y; } } } })
        });

        var compSets = [];
        ['cash', 'taxFree', 'taxDeferred', 'afterTax', 'property', 'vehicle'].forEach(function (gid) {
            if (!s.byGroup[gid].some(function (v) { return v > 0; })) return;
            compSets.push({
                label: E.GROUP_BY_ID[gid].label, data: [], gid: gid,
                borderColor: K.PALETTE[gid], backgroundColor: K.alpha(K.PALETTE[gid], 0.4),
                fill: true, pointRadius: 0, tension: 0.3, borderWidth: 1, stack: 'assets'
            });
        });
        compSets.push({ label: 'Liabilities', data: [], gid: null, borderColor: K.PALETTE.liability, borderWidth: 1.2, borderDash: [4, 4], fill: false, pointRadius: 0, tension: 0.3, stack: 'liab' });
        charts.comp = new Chart(els.body.querySelector('[data-el="compChart"]').getContext('2d'), {
            type: 'line',
            data: { labels: [], datasets: compSets },
            options: K.chartOpts({ scales: { y: { stacked: true } } })
        });

        feedCharts(state, s);
    }

    function feedCharts(state, s) {
        var labels = s.months.map(function (mo) { return E.monthLabel(mo, true); });
        if (charts.bench) {
            var bench = E.benchmarkSeries(state, s.months, K.sharedProfile());
            charts.bench.data.labels = labels;
            charts.bench.data.datasets[0].data = s.netWorth;
            charts.bench.data.datasets[1].data = bench.paw;
            charts.bench.data.datasets[2].data = bench.aaw;
            charts.bench.data.datasets[3].data = bench.uaw;
            charts.bench.update('none');
        }
        if (charts.comp) {
            charts.comp.data.labels = labels;
            charts.comp.data.datasets.forEach(function (ds) {
                ds.data = ds.gid ? s.byGroup[ds.gid] : s.liabilities;
            });
            charts.comp.update('none');
        }
    }

    function destroyCharts() {
        for (var k in charts) { if (charts[k]) { charts[k].destroy(); charts[k] = null; } }
    }

    function escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function unmount() { destroyCharts(); els = {}; }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'observatory', name: 'Net Worth', tag: 'Net worth vs. the benchmarks',
        mount: mount, update: update, unmount: unmount
    });

})(window);
