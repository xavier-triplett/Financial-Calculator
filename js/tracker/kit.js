/* TrackerKit — pieces shared by every tracker skin: the plan bridge
 * (tracker actuals ⇄ planner inputs), the Rocket Money import control,
 * chart theming, and empty states. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var E = global.TrackerEngine;

    var PALETTE = {
        cash: '#3E7C74',
        taxFree: '#17604A',
        taxDeferred: '#A9720F',
        afterTax: '#33608C',
        property: '#6B4F7A',
        vehicle: '#7A6B4F',
        liability: '#A83A31',
        ink: '#1A211D',
        income: '#17604A',
        fixed: '#A9720F',
        variable: '#33608C',
        spending: '#A83A31'
    };

    function alpha(hex, a) {
        var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    var chartFont = { family: "'IBM Plex Mono', monospace", size: 10 };

    function chartOpts(extra) {
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        var muted = dark ? '#A4AFA8' : '#66716B';
        var legend = dark ? '#C8D0CB' : '#424C46';
        var base = {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { ticks: { font: chartFont, color: muted, maxTicksLimit: 14 }, grid: { display: false } },
                y: {
                    ticks: { font: chartFont, color: muted, callback: function (v) { return U.compact(v); } },
                    grid: { color: dark ? 'rgba(232,236,232,0.09)' : 'rgba(26,33,29,0.07)' }
                }
            },
            plugins: {
                legend: { labels: { font: { family: "'Public Sans', sans-serif", size: 11 }, color: legend, boxWidth: 10, boxHeight: 10 } },
                tooltip: {
                    backgroundColor: '#1A211D', titleFont: chartFont, bodyFont: chartFont, padding: 10, cornerRadius: 4,
                    callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + U.money(c.parsed.y !== undefined ? c.parsed.y : c.parsed.x); } }
                }
            }
        };
        return deepMerge(base, extra || {});
    }

    function deepMerge(a, b) {
        for (var k in b) {
            if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]);
            else a[k] = b[k];
        }
        return a;
    }

    /* ------------------------------------------------------------------
     * Plan bridge — the data seam between tracker and planner.
     * planContext() reads the planner; proposals() computes what the
     * tracker would push back; apply() commits it.
     * ------------------------------------------------------------------ */
    /* Age & income baseline from the shared Profile tab, in the shape
     * TrackerEngine.ageIncomeAt expects. */
    function sharedProfile() {
        var st = FireStore.get();
        return { birthMonth: U.dobToMonth(st.profile.birthDate), annualIncome: st.inputs.income || null };
    }

    function planContext() {
        var results = FireApp.results();
        var inputs = FireStore.get().inputs;
        var s = results.sim.summary;
        return {
            inputs: inputs,
            fiNumber: s.fiNumber,
            netWorthAtRetirement: s.netWorthAtRetirement,
            retireAge: inputs.retireAge,
            successRate: results.mc.successRate
        };
    }

    /* proposals(state, scope) — scope 'networth' offers bucket balances,
     * 'cashflow' offers trailing income/expenses/savings rate. */
    function proposals(state, scope) {
        var out = [];
        var inputs = FireStore.get().inputs;
        if (scope === 'networth') {
            var b = E.buckets(state);
            if (b) {
                out.push({ key: 'balDeferred', label: 'Tax-deferred balance', from: inputs.balDeferred, to: Math.round(b.deferred) });
                out.push({ key: 'balFree', label: 'Tax-free balance', from: inputs.balFree, to: Math.round(b.free) });
                out.push({ key: 'balTaxable', label: 'After-tax + cash', from: inputs.balTaxable, to: Math.round(b.taxable) });
            }
        } else {
            var t = E.trailing(state.txns);
            if (t) {
                out.push({ key: 'expenses', label: 'Annual expenses (trailing)', from: inputs.expenses, to: Math.round(t.annualExpenses) });
                if (t.annualIncome > 0) {
                    // Transaction income is take-home; the planner wants gross,
                    // so gross it back up with the Profile's effective tax rate.
                    var keep = 1 - (Number(inputs.incomeTaxRate) || 0) / 100;
                    var gross = keep > 0 ? t.annualIncome / keep : t.annualIncome;
                    out.push({ key: 'income', label: 'Annual gross income (trailing)', from: inputs.income, to: Math.round(gross) });
                    out.push({ key: 'savingsRate', label: 'Savings rate', from: inputs.savingsRate, to: Math.round(Math.max(0, (t.annualIncome - t.annualExpenses) / gross) * 100), pct: true });
                }
            }
        }
        return out.filter(function (p) { return p.from !== p.to; });
    }

    function applyProposals(state, scope) {
        var list = proposals(state, scope);
        list.forEach(function (p) { FireStore.setInput(p.key, p.to); });
        return list.length;
    }

    /* renderBridge(container, state, opts) — pending diffs + apply.
     * opts.scope picks the dataset; opts.fi adds the FI progress readout. */
    function renderBridge(container, state, opts) {
        opts = opts || {};
        var scope = opts.scope || 'networth';
        var ctx = planContext();
        var list = proposals(state, scope);

        var html = '<div class="trk-bridge-head"><span class="trk-bridge-title">Plan bridge</span>' +
            '<span class="trk-bridge-sub">' +
            (scope === 'networth' ? 'balances ⇄ planner buckets' : 'spending ⇄ planner assumptions') +
            '</span></div>';

        if (opts.fi) {
            var b = E.buckets(state);
            if (b && ctx.fiNumber > 0) {
                var pct = Math.min(100, (b.investable / ctx.fiNumber) * 100);
                html += '<div class="trk-fi">' +
                    '<div class="trk-fi-row"><span>Investable today</span><strong>' + U.compact(b.investable) + '</strong></div>' +
                    '<div class="trk-fi-row"><span>FI number (plan)</span><strong>' + U.compact(ctx.fiNumber) + '</strong></div>' +
                    '<div class="trk-fi-bar"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
                    '<div class="trk-fi-pct">' + pct.toFixed(1) + '% of the way · plan retires at ' + ctx.retireAge +
                    ' · ' + (ctx.successRate * 100).toFixed(0) + '% Monte Carlo</div>' +
                '</div>';
            }
        }

        if (list.length) {
            html += '<table class="trk-bridge-diff"><tbody>';
            list.forEach(function (p) {
                var fmt = p.pct ? function (v) { return v + '%'; } : U.compact;
                html += '<tr><td>' + p.label + '</td><td class="num dim">' + fmt(p.from) + '</td>' +
                    '<td class="arrow">→</td><td class="num strong">' + fmt(p.to) + '</td></tr>';
            });
            html += '</tbody></table>' +
                '<button class="trk-btn trk-btn-primary" type="button" data-act="applyPlan">Carry actuals into the plan</button>';
        } else {
            html += '<p class="trk-bridge-ok">' +
                (scope === 'networth'
                    ? (E.buckets(state) ? 'Plan buckets already match tracked balances.' : 'Add a month to feed the plan.')
                    : (state.txns.length ? 'Plan assumptions already match tracked spending.' : 'Add transactions to feed the plan.')) +
                '</p>';
        }

        container.innerHTML = html;
        var btn = container.querySelector('[data-act="applyPlan"]');
        if (btn) btn.addEventListener('click', function () {
            var n = applyProposals(TrackerStore.get(), scope);
            FireApp.toast('Updated ' + n + ' plan input' + (n === 1 ? '' : 's') + ' from tracked actuals');
        });
    }

    /* ------------------------------------------------------------------
     * Rocket Money import — button + drag-drop, shared by all skins.
     * ------------------------------------------------------------------ */
    function importControl(opts) {
        opts = opts || {};
        var wrap = U.el('span', { class: 'trk-import' });
        var btn = U.el('button', { class: 'trk-btn' + (opts.primary ? ' trk-btn-primary' : ''), type: 'button', text: opts.label || 'Import Rocket Money CSV' });
        var input = U.el('input', { type: 'file', accept: '.csv,text/csv', style: 'display:none' });

        function handleFiles(files) {
            if (!files || !files.length) return;
            var reader = new FileReader();
            reader.onload = function () {
                var res = RocketMoney.parse(reader.result);
                if (res.error) { FireApp.toast('Import failed: ' + res.error); return; }
                var merged = TrackerStore.importTxns(res.txns);
                FireApp.toast('Imported ' + merged.added + ' transactions' +
                    (merged.duplicates ? ' (' + merged.duplicates + ' already present)' : '') +
                    (res.skipped ? ' · ' + res.skipped + ' rows skipped' : ''));
            };
            reader.readAsText(files[0]);
        }

        btn.addEventListener('click', function () { input.value = ''; input.click(); });
        input.addEventListener('change', function () { handleFiles(input.files); });
        btn.addEventListener('dragover', function (e) { e.preventDefault(); btn.classList.add('drag'); });
        btn.addEventListener('dragleave', function () { btn.classList.remove('drag'); });
        btn.addEventListener('drop', function (e) {
            e.preventDefault(); btn.classList.remove('drag');
            handleFiles(e.dataTransfer.files);
        });

        wrap.appendChild(btn);
        wrap.appendChild(input);
        return wrap;
    }

    /* Download the example CSV so an import file can be authored by hand. */
    function templateButton() {
        var btn = U.el('button', { class: 'trk-btn', type: 'button', text: 'CSV template',
            title: 'Download an example CSV in the format the importer expects' });
        btn.addEventListener('click', function () {
            var url = URL.createObjectURL(new Blob([RocketMoney.template()], { type: 'text/csv' }));
            var a = U.el('a', { href: url, download: 'rocket-money-template.csv' });
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        });
        return btn;
    }

    /* Empty-state panel; the caller supplies its own on-ramp buttons. */
    function emptyState(title, blurb, actions) {
        var box = U.el('div', { class: 'trk-empty' });
        box.appendChild(U.el('h3', { text: title }));
        box.appendChild(U.el('p', { text: blurb }));
        var row = U.el('div', { class: 'trk-empty-actions' });
        (actions || []).forEach(function (a) { if (a) row.appendChild(a); });
        box.appendChild(row);
        return box;
    }

    /* "Seed my data" button — only exists when a seed.js config is present. */
    function seedButton() {
        if (!global.TrackerSeed) return null;
        var btn = U.el('button', { class: 'trk-btn', type: 'button', text: 'Seed from config' });
        btn.addEventListener('click', function () {
            if (TrackerStore.seedFrom(global.TrackerSeed)) FireApp.toast('Seeded from config');
            else FireApp.toast('Seed config is missing accounts/snapshots');
        });
        return btn;
    }

    global.TrackerKit = {
        PALETTE: PALETTE,
        alpha: alpha,
        chartFont: chartFont,
        chartOpts: chartOpts,
        sharedProfile: sharedProfile,
        planContext: planContext,
        proposals: proposals,
        applyProposals: applyProposals,
        renderBridge: renderBridge,
        importControl: importControl,
        templateButton: templateButton,
        emptyState: emptyState,
        seedButton: seedButton
    };

})(typeof window !== 'undefined' ? window : globalThis);
