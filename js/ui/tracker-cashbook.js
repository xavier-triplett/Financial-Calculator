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
    var pendingUpdate = false;
    var searchTimer = null;

    var ZERO_AGG = { income: 0, saving: 0, fixed: 0, variable: 0, spending: 0, expenses: 0, saved: 0, byCategory: {}, count: 0, incomeCount: 0, savingCount: 0 };

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
        if (FireApp.mode() === 'expert') els.actions.appendChild(K.templateButton());
        var addMonth = U.el('button', { class: 'trk-btn', type: 'button', text: '+ Month' });
        addMonth.addEventListener('click', function () {
            // The commit re-renders before this assignment; render once more
            selMonth = TrackerStore.addCashMonth();
            update(TrackerStore.get());
        });
        els.actions.appendChild(addMonth);
        var clear = U.el('button', { class: 'trk-btn trk-btn-danger', type: 'button', text: 'Clear cashbook' });
        clear.addEventListener('click', function () {
            FireApp.confirm('Clear all Cashbook months and transactions? Net worth data will be kept.', function () {
                TrackerStore.resetCash();
                FireApp.toast('Cashbook data cleared');
            }, 'Clear cashbook');
        });
        els.actions.appendChild(clear);
        selMonth = null;
        filter = { q: '', cat: '' };
        editingId = null;
        pendingUpdate = false;
        els.body.addEventListener('focusout', function () {
            if (!pendingUpdate) return;
            setTimeout(function () {
                if (!els.body) return;
                var active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT') && els.body.contains(active)) return;
                pendingUpdate = false;
                update(TrackerStore.get());
            }, 0);
        });
    }

    /* Raw transaction months, not aggregate months: a month holding only
     * transfers has no spendByMonth entry but its rows must stay reachable. */
    function monthsOf(state) {
        var set = Object.create(null);
        state.txns.forEach(function (t) {
            var mo = E.monthKey(t.date);
            if (mo) set[mo] = true;
        });
        state.cashMonths.forEach(function (mo) { set[mo] = true; });
        return Object.keys(set).sort();
    }

    /* Months with expenses but no income transactions (Rocket Money exports
     * are often expenses-only) borrow 1/12 of the estimated annual take-home:
     * gross income — the Net Worth grid's income row or the Profile tab —
     * less the Profile's effective income tax. Marked "est."; actual income
     * transactions (already net deposits) always win. */
    function withEstIncome(state, mo, agg) {
        if (!agg || agg.count === 0 || agg.incomeCount > 0) return agg;
        var ai = E.ageIncomeAt(state, mo, K.sharedProfile());
        if (!ai) return agg;
        var keep = 1 - (Number(FireStore.get().inputs.incomeTaxRate) || 0) / 100;
        if (keep < 0) keep = 0;
        var inc = Math.round(ai.income * keep / 12);
        return Object.assign({}, agg, { income: inc, saved: inc - agg.expenses, estIncome: true });
    }

    function update(state) {
        // Never rebuild under the user's fingers: a store commit while an
        // input here is focused (e.g. a background cloud adopt) would wipe
        // a half-typed form or search. A queued refresh runs after focus leaves.
        var a = document.activeElement;
        if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT') && els.body && els.body.contains(a)) {
            pendingUpdate = true;
            return;
        }
        pendingUpdate = false;
        destroyCharts();
        if (datePicker) { datePicker.destroy(); datePicker = null; }
        if (!TrackerStore.hasCash()) {
            els.body.innerHTML = '';
            var addMonth = U.el('button', { class: 'trk-btn', type: 'button', text: 'Start first month' });
            addMonth.addEventListener('click', function () {
                selMonth = TrackerStore.addCashMonth();
                update(TrackerStore.get());
            });
            els.body.appendChild(K.emptyState('A blank cashbook',
                'Import a Rocket Money CSV (or one you author from the template), or open a month and write it by hand.',
                [K.importControl({ primary: true }), K.templateButton(), addMonth]));
            return;
        }

        var byMo = E.spendByMonth(state.txns);
        var months = monthsOf(state);
        var rawCounts = {};
        state.txns.forEach(function (t) {
            var mo = E.monthKey(t.date);
            if (mo) rawCounts[mo] = (rawCounts[mo] || 0) + 1;
        });
        if (!selMonth || months.indexOf(selMonth) === -1) selMonth = months[months.length - 1];
        var agg = withEstIncome(state, selMonth, byMo[selMonth]) || ZERO_AGG;
        // A filter for a category no longer in this month would silently show
        // nothing while the select displays "All categories"
        if (filter.cat && !Object.prototype.hasOwnProperty.call(agg.byCategory, filter.cat)) filter.cat = '';

        els.body.innerHTML =
            '<div class="trk-book">' +
                '<nav class="trk-spine" aria-label="Cashbook months" data-el="spine">' + spineHTML(state, byMo, months, rawCounts) + '</nav>' +
                '<main class="trk-page">' +
                    '<section class="trk-panel" data-el="statement">' + statementHTML(agg, rawCounts[selMonth] || 0) + '</section>' +
                    '<section class="trk-panel">' +
                        '<div class="trk-panel-head"><h2>Register</h2><div class="trk-reg-filters">' +
                            '<input class="trk-search" type="search" aria-label="Search merchants" placeholder="Search merchant…" value="' + escapeAttr(filter.q) + '" data-el="q">' +
                            '<select class="trk-select" aria-label="Filter by category" data-el="cat">' + catOptions(agg) + '</select>' +
                        '</div></div>' +
                        '<div class="trk-txnform" data-el="form">' + formHTML(state) + '</div>' +
                        '<div class="trk-regwrap" data-el="register"></div>' +
                    '</section>' +
                '</main>' +
                '<aside class="trk-book-side">' +
                    '<section class="trk-panel">' +
                        '<div class="trk-panel-head"><h2>In &amp; out</h2><span class="trk-panel-note">last 12 months</span></div>' +
                        '<div class="trk-chart trk-chart-sm"><canvas data-el="flowChart" role="img" aria-label="Monthly income, expenses, and surplus"></canvas></div>' +
                    '</section>' +
                    '<section class="trk-panel trk-bridge" data-el="bridge"></section>' +
                '</aside>' +
            '</div>';

        renderRegister(state);
        K.renderBridge(els.body.querySelector('[data-el="bridge"]'), state, { scope: 'cashflow' });
        makeFlowChart(state, byMo);
        wire(state);
    }

    function spineHTML(state, byMo, months, rawCounts) {
        return months.map(function (mo) {
            var agg = withEstIncome(state, mo, byMo[mo]);
            var saved = agg ? agg.saved : 0;
            var emptyLabel = rawCounts[mo] ? 'transfers only' : 'empty';
            return '<button class="trk-spine-mo' + (mo === selMonth ? ' active' : '') + '" type="button" data-month="' + escapeAttr(mo) + '"' +
                (mo === selMonth ? ' aria-current="page"' : '') + '>' +
                '<span class="trk-spine-label">' + E.monthLabel(mo) + '</span>' +
                '<span class="trk-spine-saved ' + (saved >= 0 ? 'pos' : 'neg') + '">' +
                    (agg ? (saved >= 0 ? '+' : '') + U.compact(saved) + (agg.estIncome ? ' <em class="trk-est">est.</em>' : '') : emptyLabel) + '</span>' +
            '</button>';
        }).reverse().join('');
    }

    function statementHTML(agg, rawCount) {
        var sections = E.categoryRows(agg);
        var saved = agg.saved;
        var rate = agg.income > 0 ? (saved / agg.income) * 100 : null;

        function rows(list) {
            return list.map(function (r) {
                return '<div class="trk-st-row"><span>' + escapeAttr(r.category) + '</span>' +
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
            ? '<div class="trk-panel-note">' + (rawCount ? 'transfers are excluded from the statement' : 'an open page — add the first transaction below') + '</div>'
            : '<div class="trk-st-stamp ' + (saved >= 0 ? 'trk-stamp-pos' : 'trk-stamp-neg') + '">' +
                (saved >= 0 ? 'Surplus' : 'Deficit') + '</div>';

        var incomeHint = agg.estIncome
            ? ' <span class="ff-hint" tabindex="0" role="img" data-tooltip="No income transactions this month, so this is 1/12 of your estimated take-home: gross annual income (the Net Worth grid&rsquo;s income row or the Profile tab) less the effective income tax set on the Profile tab. Logging even one money-in transaction switches the whole month to actuals only.">i</span>'
            : '';
        return '<div class="trk-panel-head"><h2>' + E.monthLabel(selMonth) + '</h2>' +
            '<div class="trk-st-headtools">' + stampHTML +
                '<button class="trk-mini trk-mini-del" type="button" data-act="del-month" title="Delete this month and its transactions">delete month</button>' +
            '</div></div>' +
            '<div class="trk-st-section"><div class="trk-st-title">Income' + incomeHint + '</div>' +
                rows(sections.income) +
                '<div class="trk-st-row trk-st-total"><span>' + (agg.estIncome ? 'Estimated take-home' : 'Total income') +
                '</span><span class="trk-st-dots"></span>' +
                '<span class="num pos">' + U.money(agg.income) +
                (agg.estIncome ? ' <em class="trk-est">est.</em>' : '') + '</span></div></div>' +
            section('Savings contributions', sections.saving, agg.saving) +
            section('Fixed expenses', sections.fixed, agg.fixed) +
            section('Variable expenses', sections.variable, agg.variable) +
            section('Spending', sections.spending, agg.spending) +
            '<div class="trk-st-verdict">' +
                '<span>' + (saved >= 0 ? 'Surplus' : 'Deficit') + ' this month</span>' +
                '<strong class="' + (saved >= 0 ? 'pos' : 'neg') + '">' + (saved >= 0 ? '+' : '') + U.money(saved) +
                (rate !== null ? ' <em>(' + rate.toFixed(0) + '% of income)</em>' : '') + '</strong>' +
            '</div>' +
            (agg.saving > 0
                ? '<div class="trk-st-verdict trk-st-saving">' +
                    '<span>Marked as savings' +
                        ' <span class="ff-hint" tabindex="0" role="img" data-tooltip="Transactions in savings-kind categories (Savings, Investments, Retirement Contributions, or any category you mark as Savings on the Categories tab). The plan bridge uses marked savings for those months and surplus for unmarked months.">i</span>' +
                    '</span>' +
                    '<strong class="pos">' + U.money(agg.saving) +
                    (agg.income > 0 ? ' <em>(' + ((agg.saving / agg.income) * 100).toFixed(0) + '% of income)</em>' : '') + '</strong>' +
                '</div>'
                : '');
    }

    /* ---------------- manual add / edit ---------------- */
    /* Money-out suggestions only — money-in categories come from the
     * direction select's own list. */
    function knownCategories(state) {
        var set = Object.create(null);
        state.txns.forEach(function (t) {
            if (E.categoryKind(t.category) !== 'income') set[t.category] = true;
        });
        ['Groceries', 'Dining & Drinks', 'Mortgage', 'Rent', 'Internet', 'Insurance Payments', 'Car Payments',
         'Auto & Transport', 'Gas Bill', 'Water & Light', 'Garbage', 'Subscriptions', 'Shopping',
         'Entertainment & Rec.', 'Travel & Vacation',
         'Savings', 'Investments', 'Retirement Contributions'].forEach(function (c) { set[c] = true; });
        return Object.keys(set).sort();
    }

    /* Category control per direction: money out keeps the free-text field
     * with the expense suggestions; money in offers the income categories
     * (built-ins plus anything marked income on the Categories tab). */
    function incomeCategories(state) {
        var set = Object.create(null);
        set.Income = true;
        set['Other Income'] = true;
        state.txns.forEach(function (t) { if (E.categoryKind(t.category) === 'income') set[t.category] = true; });
        var ck = state.categoryKinds || {};
        Object.keys(ck).forEach(function (c) { if (ck[c] === 'income') set[c] = true; });
        return Object.keys(set).sort();
    }

    function catControl(dir, t, state) {
        if (dir === 'in') {
            var cats = incomeCategories(state);
            if (t && E.categoryKind(t.category) === 'income' && cats.indexOf(t.category) === -1) cats.unshift(t.category);
            return '<select data-f="category" aria-label="Income category">' + cats.map(function (c) {
                return '<option value="' + escapeAttr(c) + '"' + (t && t.category === c ? ' selected' : '') + '>' + escapeAttr(c) + '</option>';
            }).join('') + '</select>';
        }
        return '<input type="text" data-f="category" aria-label="Expense or savings category" list="trk-cats" placeholder="Category" value="' +
            (t ? escapeAttr(t.category) : '') + '">';
    }

    function formHTML(state) {
        var t = editingId ? state.txns.filter(function (t) { return t.id === editingId; })[0] : null;
        if (editingId && !t) editingId = null;
        var dir = t && E.categoryKind(t.category) === 'income' ? 'in' : 'out';
        var datalist = '<datalist id="trk-cats">' + knownCategories(state).map(function (c) {
            return '<option value="' + escapeAttr(c) + '">';
        }).join('') + '</datalist>';

        return datalist +
            '<input type="date" data-f="date" aria-label="Transaction date" value="' + (t ? escapeAttr(t.date) : escapeAttr(selMonth + '-15')) + '">' +
            '<select data-f="dir" aria-label="Money in or out">' +
                '<option value="out"' + (dir === 'out' ? ' selected' : '') + '>&minus; Money out</option>' +
                '<option value="in"' + (dir === 'in' ? ' selected' : '') + '>+ Money in</option>' +
            '</select>' +
            '<input type="text" data-f="name" aria-label="Merchant or description" placeholder="Merchant" value="' + (t ? escapeAttr(t.name) : '') + '">' +
            '<input type="text" inputmode="decimal" data-f="amount" aria-label="Transaction amount" placeholder="Amount" value="' + (t ? t.amount : '') + '">' +
            '<span class="trk-catwrap" data-el="catwrap">' + catControl(dir, t, state) + '</span>' +
            '<input type="text" data-f="account" aria-label="Account" placeholder="Account" value="' + (t ? escapeAttr(t.account || '') : '') + '">' +
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
        }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });

        if (!list.length) { host.innerHTML = '<p class="trk-kpi-note">No transactions match.</p>'; return; }

        var html = '<table class="trk-register"><caption class="trk-sr-only">Transactions for ' + escapeAttr(E.monthLabel(selMonth)) + '</caption><thead><tr>' +
            '<th scope="col">Date</th><th scope="col">Merchant</th><th scope="col">Category</th><th scope="col">Account</th><th class="num" scope="col">Amount</th><th scope="col">Actions</th>' +
            '</tr></thead><tbody>';
        list.forEach(function (t) {
            var kind = E.categoryKind(t.category);
            // Income: green with a +, unless negative (a reversal, shown red).
            // Expenses: negative amounts are refunds, shown green.
            var amtCls = kind === 'income' ? (t.amount >= 0 ? 'pos' : 'neg') : (t.amount < 0 ? 'pos' : '');
            html += '<tr>' +
                '<td class="num dim">' + t.date.slice(5) + '</td>' +
                '<td>' + escapeAttr(t.name) + '</td>' +
                '<td><span class="trk-badge trk-badge-' + kind + '">' + escapeAttr(t.category) + '</span></td>' +
                '<td class="dim">' + escapeAttr(t.account || '') + '</td>' +
                '<td class="num ' + amtCls + '">' +
                    (kind === 'income' && t.amount >= 0 ? '+' : '') + U.money(t.amount) + '</td>' +
                '<td class="trk-rowbtns"><button class="trk-mini" type="button" data-edit="' + escapeAttr(t.id) + '" aria-label="Edit ' + escapeAttr(t.name) + '">edit</button>' +
                    '<button class="trk-x trk-x-visible" type="button" data-del-txn="' + escapeAttr(t.id) + '" aria-label="Delete ' + escapeAttr(t.name) + '">&times;</button></td>' +
            '</tr>';
        });
        host.innerHTML = html + '</tbody></table>';
    }

    function makeFlowChart(state, byMo) {
        var take = E.monthWindow(state.txns, 12, state.cashMonths);
        var aggs = take.map(function (mo) { return withEstIncome(state, mo, byMo[mo]) || ZERO_AGG; });
        charts.flow = new Chart(els.body.querySelector('[data-el="flowChart"]').getContext('2d'), {
            type: 'bar',
            data: {
                labels: take.map(function (mo) { return E.monthLabel(mo, true); }),
                datasets: [
                    // Estimated-income months get a paler In bar
                    { label: 'In', data: aggs.map(function (a) { return a.income; }),
                      backgroundColor: aggs.map(function (a) { return K.alpha(K.PALETTE.income, a.estIncome ? 0.3 : 0.7); }) },
                    { label: 'Out', data: aggs.map(function (a) { return a.expenses; }), backgroundColor: K.alpha(K.PALETTE.spending, 0.65) },
                    { label: 'Surplus', type: 'line', data: aggs.map(function (a) { return a.saved; }),
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
                dateFormat: 'Y-m-d', disableMobile: true, yearRange: [yr - 50, yr + 2]
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
        q.addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () {
                searchTimer = null;
                if (!els.body || !document.contains(q)) return;
                filter.q = q.value;
                renderRegister(TrackerStore.get());
            }, 150);
        });
        els.body.querySelector('[data-el="cat"]').addEventListener('change', function (e) {
            filter.cat = e.target.value;
            renderRegister(TrackerStore.get());
        });

        els.body.querySelector('[data-el="form"]').addEventListener('change', function (e) {
            if (e.target.dataset.f !== 'dir') return;
            var st = TrackerStore.get();
            var t = editingId ? st.txns.filter(function (t) { return t.id === editingId; })[0] : null;
            // Keep the txn's category only when it matches the chosen direction
            if (t && (E.categoryKind(t.category) === 'income') !== (e.target.value === 'in')) t = null;
            els.body.querySelector('[data-el="catwrap"]').innerHTML = catControl(e.target.value, t, st);
        });

        els.body.querySelector('[data-el="form"]').addEventListener('click', function (e) {
            if (e.target.dataset.act === 'save') {
                var f = readForm();
                if (!E.validDate(f.date) || f.amount === null || !Number.isFinite(f.amount)) {
                    FireApp.toast('Enter a valid date and amount');
                    return;
                }
                if (f.dir === 'out' && E.categoryKind(f.category) === 'income') {
                    FireApp.toast('Choose Money in for an income category');
                    return;
                }
                // The store notifies synchronously, so view state must be set
                // BEFORE the commit or the re-render shows the old state (and
                // a second Save click would duplicate the transaction)
                if (editingId) {
                    var id = editingId;
                    var priorMonth = selMonth;
                    editingId = null;
                    selMonth = E.monthKey(f.date);
                    if (TrackerStore.updateTxn(id, f)) {
                        FireApp.toast('Transaction updated');
                    } else {
                        editingId = id;
                        selMonth = priorMonth;
                        FireApp.toast('Transaction could not be updated');
                    }
                } else {
                    var prev = selMonth;
                    selMonth = E.monthKey(f.date) || prev;
                    if (TrackerStore.addTxn(f)) {
                        FireApp.toast('Transaction added');
                    } else {
                        selMonth = prev; // invalid form: nothing committed or rendered
                        FireApp.toast('Enter a valid date and amount');
                    }
                }
            } else if (e.target.dataset.act === 'cancel') {
                editingId = null;
                update(TrackerStore.get());
            }
        });

        els.body.querySelector('[data-el="statement"]').addEventListener('click', function (e) {
            if (e.target.dataset.act !== 'del-month') return;
            var mo = selMonth;
            var count = TrackerStore.get().txns.filter(function (t) { return E.monthKey(t.date) === mo; }).length;
            FireApp.confirm('Delete ' + E.monthLabel(mo) +
                (count ? ' and its ' + count + ' transaction' + (count === 1 ? '' : 's') : '') + '?', function () {
                selMonth = null;
                editingId = null;
                TrackerStore.removeCashMonth(mo);
                FireApp.toast(E.monthLabel(mo) + ' deleted');
            });
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
            return '<option value="' + escapeAttr(c) + '"' + (c === filter.cat ? ' selected' : '') + '>' + escapeAttr(c) + '</option>';
        }).join('');
    }

    function escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function destroyCharts() {
        if (charts.flow) { charts.flow.destroy(); charts.flow = null; }
    }

    function unmount() {
        clearTimeout(searchTimer);
        searchTimer = null;
        pendingUpdate = false;
        destroyCharts();
        if (datePicker) { datePicker.destroy(); datePicker = null; }
        els = {};
    }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'cashbook', name: 'Cashbook', tag: 'One month per page',
        mount: mount, update: update, unmount: unmount
    });

})(window);
