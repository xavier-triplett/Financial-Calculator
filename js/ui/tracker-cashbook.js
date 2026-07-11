/* UI: CASHBOOK — a month-at-a-time budgeting journal, deliberately blind to
 * net worth. A spine of months down the left, one month's cashflow
 * statement in the middle (with a SURPLUS/DEFICIT stamp in the house
 * style), and the raw transaction register beneath it. Rocket Money CSV
 * imports land here; months and transactions can also be added by hand. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var E = global.TrackerEngine;
    var K = global.TrackerKit;
    var charts = { flow: null };
    var els = {};
    var selMonth = null;
    var filter = { q: '', cat: '' };
    var editingId = null;
    var datePicker = null;

    var ZERO_AGG = { income: 0, fixed: 0, variable: 0, spending: 0, expenses: 0, saved: 0, byCategory: {}, count: 0 };

    function template() {
        return '' +
        '<div class="trk-shell">' +
            '<header class="trk-masthead">' +
                '<div>' +
                    '<span class="trk-eyebrow">Monthly budgeting · actuals</span>' +
                    '<h1>The Cashbook</h1>' +
                    '<span class="trk-sub">One month per page &mdash; income in, spending out, the rest set aside</span>' +
                '</div>' +
                '<div class="trk-mast-actions" data-el="actions"></div>' +
            '</header>' +
            '<div data-el="body"></div>' +
        '</div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = { root: root, body: root.querySelector('[data-el="body"]'), actions: root.querySelector('[data-el="actions"]') };
        els.actions.appendChild(K.importControl({ primary: true }));
        var addMonth = U.el('button', { class: 'trk-btn', type: 'button', text: '+ Month' });
        addMonth.addEventListener('click', function () { selMonth = TrackerStore.addCashMonth(); });
        els.actions.appendChild(addMonth);
        var clear = U.el('button', { class: 'trk-btn trk-btn-danger', type: 'button', text: 'Clear data' });
        clear.addEventListener('click', function () {
            FireApp.confirm('Clear all tracked data (net worth and cashbook)?', function () {
                TrackerStore.reset();
                FireApp.toast('Tracked data cleared');
            }, 'Clear data');
        });
        els.actions.appendChild(clear);
        selMonth = null;
        filter = { q: '', cat: '' };
        editingId = null;
    }

    function monthsOf(state) {
        var set = {};
        E.txnMonths(state.txns).forEach(function (mo) { set[mo] = true; });
        state.cashMonths.forEach(function (mo) { set[mo] = true; });
        return Object.keys(set).sort();
    }

    /* Months with expenses but no income transactions (Rocket Money exports
     * are often expenses-only) borrow 1/12 of the effective annual income —
     * the Net Worth grid's income row or the Profile tab — marked "est.".
     * Actual income transactions always win. */
    function withEstIncome(state, mo, agg) {
        if (!agg || agg.count === 0 || agg.income > 0) return agg;
        var ai = E.ageIncomeAt(state, mo, K.sharedProfile());
        if (!ai) return agg;
        var inc = Math.round(ai.income / 12);
        return Object.assign({}, agg, { income: inc, saved: inc - agg.expenses, estIncome: true });
    }

    function update(state) {
        destroyCharts();
        if (datePicker) { datePicker.destroy(); datePicker = null; }
        if (!TrackerStore.hasCash()) {
            els.body.innerHTML = '';
            var addMonth = U.el('button', { class: 'trk-btn', type: 'button', text: 'Start first month' });
            addMonth.addEventListener('click', function () { selMonth = TrackerStore.addCashMonth(); });
            els.body.appendChild(K.emptyState('A blank cashbook',
                'Import a Rocket Money CSV, open a month and write it by hand, or seed from your config file.',
                [K.importControl({ primary: true }), addMonth, K.seedButton()]));
            return;
        }

        var byMo = E.spendByMonth(state.txns);
        var months = monthsOf(state);
        if (!selMonth || months.indexOf(selMonth) === -1) selMonth = months[months.length - 1];
        var agg = withEstIncome(state, selMonth, byMo[selMonth]) || ZERO_AGG;

        els.body.innerHTML =
            '<div class="trk-book">' +
                '<nav class="trk-spine" data-el="spine">' + spineHTML(state, byMo, months) + '</nav>' +
                '<main class="trk-page">' +
                    '<section class="trk-panel" data-el="statement">' + statementHTML(agg) + '</section>' +
                    '<section class="trk-panel">' +
                        '<div class="trk-panel-head"><h2>Register</h2><div class="trk-reg-filters">' +
                            '<input class="trk-search" type="search" placeholder="Search merchant…" value="' + escapeAttr(filter.q) + '" data-el="q">' +
                            '<select class="trk-select" data-el="cat">' + catOptions(agg) + '</select>' +
                        '</div></div>' +
                        '<div class="trk-txnform" data-el="form">' + formHTML(state) + '</div>' +
                        '<div class="trk-regwrap" data-el="register"></div>' +
                    '</section>' +
                '</main>' +
                '<aside class="trk-book-side">' +
                    '<section class="trk-panel">' +
                        '<div class="trk-panel-head"><h2>In &amp; out</h2><span class="trk-panel-note">last 12 months</span></div>' +
                        '<div class="trk-chart trk-chart-sm"><canvas data-el="flowChart"></canvas></div>' +
                    '</section>' +
                    '<section class="trk-panel trk-bridge" data-el="bridge"></section>' +
                '</aside>' +
            '</div>';

        renderRegister(state);
        K.renderBridge(els.body.querySelector('[data-el="bridge"]'), state, { scope: 'cashflow' });
        makeFlowChart(state, byMo, months);
        wire(state);
    }

    function spineHTML(state, byMo, months) {
        return months.map(function (mo) {
            var agg = withEstIncome(state, mo, byMo[mo]);
            var saved = agg ? agg.saved : 0;
            return '<button class="trk-spine-mo' + (mo === selMonth ? ' active' : '') + '" data-month="' + mo + '">' +
                '<span class="trk-spine-label">' + E.monthLabel(mo) + '</span>' +
                '<span class="trk-spine-saved ' + (saved >= 0 ? 'pos' : 'neg') + '">' +
                    (agg ? (saved >= 0 ? '+' : '') + U.compact(saved) : 'empty') + '</span>' +
            '</button>';
        }).reverse().join('');
    }

    function statementHTML(agg) {
        var sections = E.categoryRows(agg);
        var saved = agg.saved;
        var rate = agg.income > 0 ? (saved / agg.income) * 100 : null;

        function rows(list) {
            return list.map(function (r) {
                return '<div class="trk-st-row"><span>' + r.category + '</span>' +
                    '<span class="trk-st-dots"></span><span class="num">' + U.money(r.amount) + '</span></div>';
            }).join('');
        }
        function section(title, list, total) {
            if (!list.length) return '';
            return '<div class="trk-st-section"><div class="trk-st-title">' + title + '</div>' + rows(list) +
                '<div class="trk-st-row trk-st-total"><span>Total ' + title.toLowerCase() + '</span>' +
                '<span class="trk-st-dots"></span><span class="num">' + U.money(total) + '</span></div></div>';
        }

        var stampHTML = agg.count === 0
            ? '<div class="trk-panel-note">an open page — add the first transaction below</div>'
            : '<div class="trk-st-stamp ' + (saved >= 0 ? 'trk-stamp-pos' : 'trk-stamp-neg') + '">' +
                (saved >= 0 ? 'Surplus' : 'Deficit') + '</div>';

        var incomeHint = agg.estIncome
            ? ' <span class="ff-hint" tabindex="0" role="img" data-tooltip="No income transactions this month, so this is 1/12 of your annual income (from the Net Worth grid&rsquo;s income row or the Profile tab). Add paycheck transactions to use actuals.">i</span>'
            : '';
        return '<div class="trk-panel-head"><h2>' + E.monthLabel(selMonth) + '</h2>' + stampHTML + '</div>' +
            '<div class="trk-st-section"><div class="trk-st-title">Income' + incomeHint + '</div>' +
                '<div class="trk-st-row trk-st-total"><span>Total income</span><span class="trk-st-dots"></span>' +
                '<span class="num pos">' + U.money(agg.income) +
                (agg.estIncome ? ' <em class="trk-est">est.</em>' : '') + '</span></div></div>' +
            section('Fixed expenses', sections.fixed, agg.fixed) +
            section('Variable expenses', sections.variable, agg.variable) +
            section('Spending', sections.spending, agg.spending) +
            '<div class="trk-st-verdict">' +
                '<span>Set aside this month</span>' +
                '<strong class="' + (saved >= 0 ? 'pos' : 'neg') + '">' + (saved >= 0 ? '+' : '') + U.money(saved) +
                (rate !== null ? ' <em>(' + rate.toFixed(0) + '% of income)</em>' : '') + '</strong>' +
            '</div>';
    }

    /* ---------------- manual add / edit ---------------- */
    function knownCategories(state) {
        var set = {};
        state.txns.forEach(function (t) { set[t.category] = true; });
        ['Groceries', 'Dining & Drinks', 'Mortgage', 'Rent', 'Internet', 'Insurance Payments', 'Car Payments',
         'Auto & Transport', 'Gas Bill', 'Water & Light', 'Garbage', 'Subscriptions', 'Shopping',
         'Entertainment & Rec.', 'Travel & Vacation', 'Paychecks', 'Other Income'].forEach(function (c) { set[c] = true; });
        return Object.keys(set).sort();
    }

    function formHTML(state) {
        var t = editingId ? state.txns.filter(function (t) { return t.id === editingId; })[0] : null;
        if (editingId && !t) editingId = null;
        var datalist = '<datalist id="trk-cats">' + knownCategories(state).map(function (c) {
            return '<option value="' + escapeAttr(c) + '">';
        }).join('') + '</datalist>';

        return datalist +
            '<input type="date" data-f="date" value="' + (t ? t.date : selMonth + '-15') + '">' +
            '<input type="text" data-f="name" placeholder="Merchant" value="' + (t ? escapeAttr(t.name) : '') + '">' +
            '<input type="text" inputmode="decimal" data-f="amount" placeholder="Amount" value="' + (t ? t.amount : '') + '">' +
            '<input type="text" data-f="category" list="trk-cats" placeholder="Category" value="' + (t ? escapeAttr(t.category) : '') + '">' +
            '<input type="text" data-f="account" placeholder="Account" value="' + (t ? escapeAttr(t.account || '') : '') + '">' +
            '<button class="trk-btn trk-btn-primary" type="button" data-act="save">' + (t ? 'Save' : 'Add') + '</button>' +
            (t ? '<button class="trk-btn" type="button" data-act="cancel">Cancel</button>' : '');
    }

    function readForm() {
        var out = {};
        els.body.querySelectorAll('[data-f]').forEach(function (i) { out[i.dataset.f] = i.value; });
        out.amount = U.parseNum(out.amount); // "$18.50" -> 18.5, empty -> null
        return out;
    }

    /* ---------------- register ---------------- */
    function renderRegister(state) {
        var host = els.body.querySelector('[data-el="register"]');
        var q = filter.q.toLowerCase();
        var list = state.txns.filter(function (t) {
            if (E.monthKey(t.date) !== selMonth) return false;
            if (filter.cat && t.category !== filter.cat) return false;
            if (q && (t.name || '').toLowerCase().indexOf(q) === -1) return false;
            return true;
        }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });

        if (!list.length) { host.innerHTML = '<p class="trk-kpi-note">No transactions match.</p>'; return; }

        var html = '<table class="trk-register"><thead><tr>' +
            '<th>Date</th><th>Merchant</th><th>Category</th><th>Account</th><th class="num">Amount</th><th></th>' +
            '</tr></thead><tbody>';
        list.forEach(function (t) {
            var kind = E.categoryKind(t.category);
            html += '<tr>' +
                '<td class="num dim">' + t.date.slice(5) + '</td>' +
                '<td>' + escapeAttr(t.name) + '</td>' +
                '<td><span class="trk-badge trk-badge-' + kind + '">' + escapeAttr(t.category) + '</span></td>' +
                '<td class="dim">' + escapeAttr(t.account || '') + '</td>' +
                '<td class="num ' + (kind === 'income' ? 'pos' : (t.amount < 0 ? 'pos' : '')) + '">' +
                    (kind === 'income' ? '+' : '') + U.money(t.amount) + '</td>' +
                '<td class="trk-rowbtns"><button class="trk-mini" data-edit="' + t.id + '">edit</button>' +
                    '<button class="trk-x" style="visibility:visible" data-del-txn="' + t.id + '" title="Delete">&times;</button></td>' +
            '</tr>';
        });
        host.innerHTML = html + '</tbody></table>';
    }

    function makeFlowChart(state, byMo, months) {
        var take = months.slice(-12);
        var aggs = take.map(function (mo) { return withEstIncome(state, mo, byMo[mo]) || ZERO_AGG; });
        charts.flow = new Chart(els.body.querySelector('[data-el="flowChart"]').getContext('2d'), {
            type: 'bar',
            data: {
                labels: take.map(function (mo) { return E.monthLabel(mo, true); }),
                datasets: [
                    { label: 'In', data: aggs.map(function (a) { return a.income; }), backgroundColor: K.alpha(K.PALETTE.income, 0.7) },
                    { label: 'Out', data: aggs.map(function (a) { return a.expenses; }), backgroundColor: K.alpha(K.PALETTE.spending, 0.65) },
                    { label: 'Set aside', type: 'line', data: aggs.map(function (a) { return a.saved; }),
                      borderColor: K.PALETTE.ink, borderWidth: 1.8, pointRadius: 2, tension: 0.3, fill: false }
                ]
            },
            options: K.chartOpts({ plugins: { legend: { labels: { boxWidth: 8, boxHeight: 8 } } } })
        });
    }

    function wire(state) {
        var amt = els.body.querySelector('[data-f="amount"]');
        if (amt) U.bindCurrency(amt, { prefix: true, cents: true });

        var dateEl = els.body.querySelector('[data-f="date"]');
        if (dateEl) {
            var yr = new Date().getFullYear();
            datePicker = U.datePicker(dateEl, {
                dateFormat: 'Y-m-d', disableMobile: true, yearRange: [yr - 10, yr + 1]
            });
        }

        els.body.querySelector('[data-el="spine"]').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-month]');
            if (!btn) return;
            selMonth = btn.dataset.month;
            filter.cat = '';
            editingId = null;
            update(TrackerStore.get());
        });
        var q = els.body.querySelector('[data-el="q"]');
        q.addEventListener('input', U.debounce(function () {
            filter.q = q.value;
            renderRegister(TrackerStore.get());
        }, 150));
        els.body.querySelector('[data-el="cat"]').addEventListener('change', function (e) {
            filter.cat = e.target.value;
            renderRegister(TrackerStore.get());
        });

        els.body.querySelector('[data-el="form"]').addEventListener('click', function (e) {
            if (e.target.dataset.act === 'save') {
                var f = readForm();
                if (editingId) {
                    TrackerStore.updateTxn(editingId, f);
                    editingId = null;
                    FireApp.toast('Transaction updated');
                } else if (TrackerStore.addTxn(f)) {
                    selMonth = E.monthKey(f.date) || selMonth;
                    FireApp.toast('Transaction added');
                } else {
                    FireApp.toast('A date and an amount are required');
                }
            } else if (e.target.dataset.act === 'cancel') {
                editingId = null;
                update(TrackerStore.get());
            }
        });

        els.body.querySelector('[data-el="register"]').addEventListener('click', function (e) {
            var t = e.target;
            if (t.dataset.edit) {
                editingId = t.dataset.edit;
                update(TrackerStore.get());
                els.body.querySelector('[data-f="name"]').focus();
            } else if (t.dataset.delTxn) {
                FireApp.confirm('Delete this transaction?', function () {
                    TrackerStore.removeTxn(t.dataset.delTxn);
                    FireApp.toast('Transaction deleted');
                });
            }
        });
    }

    function catOptions(agg) {
        var cats = Object.keys(agg.byCategory).sort();
        return '<option value="">All categories</option>' + cats.map(function (c) {
            return '<option value="' + escapeAttr(c) + '"' + (c === filter.cat ? ' selected' : '') + '>' + c + '</option>';
        }).join('');
    }

    function escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function destroyCharts() {
        if (charts.flow) { charts.flow.destroy(); charts.flow = null; }
    }

    function unmount() {
        destroyCharts();
        if (datePicker) { datePicker.destroy(); datePicker = null; }
        els = {};
    }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'cashbook', name: 'Cashbook', tag: 'One month per page',
        mount: mount, update: update, unmount: unmount
    });

})(window);
