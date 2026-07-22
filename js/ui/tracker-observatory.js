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
    var pendingUpdate = false;

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
            FireApp.confirm('Clear all net worth accounts and monthly balances? Cashbook data will be kept.', function () {
                TrackerStore.resetNetWorth();
                FireApp.toast('Net worth data cleared');
            }, 'Clear net worth');
        });
        els.actions.appendChild(clear);
        els.body.addEventListener('focusout', function () {
            if (!pendingUpdate) return;
            setTimeout(function () {
                if (!els.body || editingInput(els.body.querySelector('[data-el="grid"]'))) return;
                pendingUpdate = false;
                update(TrackerStore.get());
            }, 0);
        });
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
        var priorKey = n ? E.previousMonth(s.months[n - 1]) : null;
        var priorIndex = priorKey ? s.months.indexOf(priorKey) : -1;
        var d1 = priorIndex >= 0 ? nw - s.netWorth[priorIndex] : null;
        var yearKey = n ? String(Number(s.months[n - 1].slice(0, 4)) - 1) + s.months[n - 1].slice(4) : null;
        var yearIndex = yearKey ? s.months.indexOf(yearKey) : -1;
        var d12 = yearIndex >= 0 ? nw - s.netWorth[yearIndex] : null;
        var ctx = K.planContext();
        // Market buckets vs a today's-dollar target: cash is excluded (the
        // plan holds it inert) and both sides share today's units.
        var market = n ? s.byGroup.taxFree[n - 1] + s.byGroup.taxDeferred[n - 1] + s.byGroup.afterTax[n - 1] : 0;
        var target = K.fiTargetToday();
        var fiPct = n && target > 0 ? (market / target) * 100 : null;
        var ai = n ? E.ageIncomeAt(state, s.months[n - 1], K.sharedProfile()) : null;
        var verdict = wealthVerdict(nw, ai && E.benchmarks(ai.age, ai.income));
        var nwNotes = [];
        if (d1 !== null) nwNotes.push((d1 >= 0 ? '+' : '') + U.compact(d1) + ' this month');
        else nwNotes.push(n === 1 ? 'first tracked month' : 'month comparison needs the prior calendar month');
        if (n > 1) nwNotes.push(d12 !== null
            ? (d12 >= 0 ? '+' : '') + U.compact(d12) + ' over the year'
            : 'year comparison needs the same month last year');

        var beginner = FireApp.mode() === 'beginner';
        var html = '<section class="trk-kpis' + (beginner ? ' trk-kpis-3' : '') + '" data-el="kpis-inner">';
        html += kpi('Net worth', n ? U.compact(nw) : '—', nwNotes.join(' · '),
            d1 !== null && d1 < 0 ? 'neg' : '');
        html += kpi('Investable', n ? U.compact(s.investable[n - 1]) : '—',
            n ? 'against ' + U.compact(s.liabilities[n - 1]) + ' of liabilities' : 'no months yet');
        if (!beginner) html += kpi('Accumulator', verdict.label, verdict.note, verdict.cls);
        html += kpi('Progress to FI', fiPct === null ? '—' : fiPct.toFixed(1) + '%',
            fiPct === null ? 'the planner sets the target' :
                U.compact(market) + ' invested of ' + U.compact(target) + ' in today&rsquo;s dollars · plan retires at ' + ctx.retireAge);
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
                'Start a month, then add accounts and balances to the grid.',
                [start]));
            return;
        }

        // While typing in the grid, refresh derived cells and charts in place.
        var focused = editingInput(els.body.querySelector('[data-el="grid"]'));
        if (focused) {
            pendingUpdate = true;
            syncDerived(state);
            return;
        }
        pendingUpdate = false;

        var s = E.series(state);
        destroyCharts();
        var beginner = FireApp.mode() === 'beginner';
        var benchmarkPanel = beginner ? '' :
            '<section class="trk-panel">' +
                '<div class="trk-panel-head"><h2>Net worth vs. the benchmarks</h2>' +
                '<span class="trk-panel-note">PAW &middot; AAW &middot; UAW &mdash; expected accumulation for your age and income</span></div>' +
                '<div class="trk-chart trk-chart-tall"><canvas data-el="benchChart" role="img" aria-label="Net worth compared with accumulator benchmarks"></canvas></div>' +
            '</section>';
        var chartsArea = beginner
            ? '<section class="trk-panel">' +
                '<div class="trk-panel-head"><h2>Composition</h2><span class="trk-panel-note">Assets stacked by group &middot; liabilities dashed</span></div>' +
                '<div class="trk-chart"><canvas data-el="compChart" role="img" aria-label="Net worth composition by account group"></canvas></div></section>' +
                '<section class="trk-panel trk-bridge" data-el="bridge"></section>'
            : '<div class="trk-obs-grid">' +
                '<section class="trk-panel trk-obs-main"><div class="trk-panel-head"><h2>Composition</h2>' +
                '<span class="trk-panel-note">Assets stacked by group &middot; liabilities dashed</span></div>' +
                '<div class="trk-chart"><canvas data-el="compChart" role="img" aria-label="Net worth composition by account group"></canvas></div></section>' +
                '<aside class="trk-obs-side"><section class="trk-panel"><div class="trk-panel-head"><h2>Benchmark profile</h2></div>' +
                '<p class="trk-kpi-note" style="margin:0" data-el="profileSummary">' + profileSummary(state) + '</p></section>' +
                '<section class="trk-panel trk-bridge" data-el="bridge"></section></aside></div>';
        els.body.innerHTML =
            '<div data-el="kpis">' + kpisHTML(state, s) + '</div>' +
            benchmarkPanel + chartsArea +
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

        var head = '<tr><th class="trk-sticky" scope="col">Account</th>';
        months.forEach(function (mo) {
            head += '<th class="num" scope="col">' + E.monthLabel(mo, true) +
                '<button class="trk-x" type="button" data-del-month="' + escapeAttr(mo) + '" aria-label="Remove ' + escapeAttr(E.monthLabel(mo)) + '">&times;</button></th>';
        });
        head += '</tr>';

        var body = '';
        E.GROUPS.forEach(function (g) {
            var accts = state.accounts.filter(function (a) { return a.group === g.id; });
            body += '<tr class="trk-grouprow"><th class="trk-sticky" scope="row">' + g.label +
                ' <button class="trk-mini" type="button" data-add-acct="' + g.id + '" aria-label="Add ' + escapeAttr(g.label) + ' account">+ account</button></th>' +
                '<td colspan="' + months.length + '"></td></tr>';
            accts.forEach(function (a) {
                body += '<tr><th class="trk-sticky trk-acctcell" scope="row">' +
                    '<input class="trk-acct-name" aria-label="Account name" value="' + escapeAttr(a.name) + '" data-rename="' + escapeAttr(a.id) + '">' +
                    '<button class="trk-x" type="button" data-del-acct="' + escapeAttr(a.id) + '" aria-label="Remove ' + escapeAttr(a.name) + '">&times;</button></th>';
                months.forEach(function (mo) {
                    var v = state.snapshots[mo][a.id];
                    body += '<td class="num"><input class="trk-cell" type="text" inputmode="numeric" value="' +
                        (v === undefined ? '' : Math.round(v)) + '" aria-label="' + escapeAttr(a.name + ', ' + E.monthLabel(mo)) +
                        '" data-month="' + escapeAttr(mo) + '" data-acct="' + escapeAttr(a.id) + '"></td>';
                });
                body += '</tr>';
            });
            if (accts.length && g.id !== 'liability') {
                body += '<tr class="trk-subtotal"><th class="trk-sticky" scope="row">Total ' + g.label.toLowerCase() + '</th>';
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
        body += '<tr class="trk-deltarow"><th class="trk-sticky" scope="row">Change</th>' + deltas.map(function (d, i) {
            return '<td class="num ' + (d > 0 ? 'pos' : d < 0 ? 'neg' : '') + '" data-sub="delta:' + i + '">' +
                (d === null ? '—' : (d > 0 ? '+' : '') + U.compact(d)) + '</td>';
        }).join('') + '</tr>';

        // Benchmark income: record a raise in the month it lands; blank
        // months inherit from the last recorded month or the Profile tab.
        var profile = K.sharedProfile();
        if (FireApp.mode() === 'expert') {
            body += '<tr class="trk-incomerow"><th class="trk-sticky" scope="row">Annual income' +
            ' <span class="ff-hint" tabindex="0" role="img" data-tooltip="Gross annual income used for the PAW / AAW / UAW benchmarks. Type it in the month it changes; blank months inherit from the last recorded month, or the Profile tab.">i</span></th>';
        months.forEach(function (mo) {
            var rec = (state.ageIncome || {})[mo];
            var eff = E.ageIncomeAt(state, mo, profile);
            body += '<td class="num"><input class="trk-cell trk-income" type="text" inputmode="numeric" value="' +
                (rec && rec.income !== undefined ? Math.round(rec.income) : '') +
                '" aria-label="Annual income for ' + escapeAttr(E.monthLabel(mo)) + '" placeholder="' +
                (eff ? U.moneyStr(eff.income, true) : '—') + '" data-income-month="' + escapeAttr(mo) + '"></td>';
        });
            body += '</tr>';
        }

        return '<table class="trk-grid"><caption class="trk-sr-only">Net worth accounts and monthly balances</caption><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    }

    function totalRow(label, arr, key, cls) {
        var html = '<tr class="trk-total ' + (cls || '') + '"><th class="trk-sticky" scope="row">' + label + '</th>';
        arr.forEach(function (v, i) { html += '<td class="num" data-sub="' + key + ':' + i + '">' + U.compact(v) + '</td>'; });
        return html + '</tr>';
    }

    function wireGrid() {
        var grid = els.body.querySelector('[data-el="grid"]');
        grid.addEventListener('change', function (e) {
            var t = e.target;
            if (t.dataset.month) {
                var balance = U.parseNum(t.value);
                if (balance === null && !t.value.trim()) balance = 0;
                if (!TrackerStore.setBalance(t.dataset.month, t.dataset.acct, balance)) FireApp.toast('Enter a valid balance');
            } else if (t.dataset.incomeMonth) {
                var income = U.parseNum(t.value);
                if (income === null && t.value.trim()) FireApp.toast('Enter a valid annual income');
                else if (!TrackerStore.setAgeIncome(t.dataset.incomeMonth, income)) FireApp.toast('Enter a valid annual income');
            } else if (t.dataset.rename && !TrackerStore.renameAccount(t.dataset.rename, t.value)) {
                var account = TrackerStore.get().accounts.filter(function (a) { return a.id === t.dataset.rename; })[0];
                if (account) t.value = account.name;
                FireApp.toast('Account names cannot be blank');
            }
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
        // The income row's inherited placeholders and the profile panel also
        // derive from ageIncome, so refresh them too (skip the focused cell)
        var profile = K.sharedProfile();
        els.body.querySelectorAll('input[data-income-month]').forEach(function (inp) {
            if (inp === document.activeElement) return;
            var eff = E.ageIncomeAt(state, inp.getAttribute('data-income-month'), profile);
            inp.placeholder = eff ? U.moneyStr(eff.income, true) : '—';
        });
        var ps = els.body.querySelector('[data-el="profileSummary"]');
        if (ps) ps.innerHTML = profileSummary(state);
        var bridge = els.body.querySelector('[data-el="bridge"]');
        if (bridge) K.renderBridge(bridge, state, { scope: 'networth', fi: true });
        reconcileComposition(s);
        feedCharts(state, s);
    }

    /* ---------------- charts ---------------- */
    function makeCharts(state, s) {
        var benchCanvas = els.body.querySelector('[data-el="benchChart"]');
        if (benchCanvas) charts.bench = new Chart(benchCanvas.getContext('2d'), {
            type: 'line',
            data: { labels: [], datasets: [
                { label: 'Net worth', data: [], borderColor: K.PALETTE.ink, backgroundColor: K.alpha(K.PALETTE.ink, 0.05), borderWidth: 2.4, fill: true, pointRadius: 0, tension: 0.3 },
                { label: 'PAW (2× expected)', data: [], borderColor: K.PALETTE.taxFree, borderWidth: 1.4, borderDash: [7, 4], fill: false, pointRadius: 0, tension: 0.3 },
                { label: 'AAW (expected)', data: [], borderColor: K.PALETTE.taxDeferred, borderWidth: 1.4, borderDash: [7, 4], fill: false, pointRadius: 0, tension: 0.3 },
                { label: 'UAW (½ expected)', data: [], borderColor: K.PALETTE.liability, borderWidth: 1.4, borderDash: [7, 4], fill: false, pointRadius: 0, tension: 0.3 }
            ]},
            options: K.chartOpts({ plugins: { tooltip: { itemSort: function (a, b) { return b.parsed.y - a.parsed.y; } } } })
        });

        makeComposition(s);
        feedCharts(state, s);
    }

    function compositionSets(s) {
        var compSets = [];
        ['cash', 'taxFree', 'taxDeferred', 'afterTax', 'property', 'vehicle'].forEach(function (gid) {
            if (!s.byGroup[gid].some(function (v) { return v !== 0; })) return;
            compSets.push({
                label: E.GROUP_BY_ID[gid].label, data: [], gid: gid,
                borderColor: K.PALETTE[gid], backgroundColor: K.alpha(K.PALETTE[gid], 0.4),
                fill: true, pointRadius: 0, tension: 0.3, borderWidth: 1, stack: 'assets'
            });
        });
        compSets.push({ label: 'Liabilities', data: [], gid: null, borderColor: K.PALETTE.liability, borderWidth: 1.2, borderDash: [4, 4], fill: false, pointRadius: 0, tension: 0.3, stack: 'liab' });
        return compSets;
    }

    function makeComposition(s) {
        var canvas = els.body.querySelector('[data-el="compChart"]');
        if (!canvas) return;
        charts.comp = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels: [], datasets: compositionSets(s) },
            options: K.chartOpts({ scales: { y: { stacked: true } } })
        });
    }

    function reconcileComposition(s) {
        if (!charts.comp) return;
        var desired = compositionSets(s).map(function (ds) { return ds.gid || 'liability'; }).join('|');
        var current = charts.comp.data.datasets.map(function (ds) { return ds.gid || 'liability'; }).join('|');
        if (desired === current) return;
        charts.comp.destroy();
        charts.comp = null;
        makeComposition(s);
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
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function unmount() { pendingUpdate = false; destroyCharts(); els = {}; }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'observatory', name: 'Net Worth', tag: 'Net worth vs. the benchmarks',
        mount: mount, update: update, unmount: unmount
    });

})(window);
