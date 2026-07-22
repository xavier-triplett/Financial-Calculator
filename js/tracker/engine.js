/* =========================================================================
 * TrackerEngine — pure calculation core for the net-worth & expenses
 * tracker. No DOM access; attaches to window in the browser and globalThis
 * in Node so it can be unit-tested from the command line.
 *
 * Data model (owned by TrackerStore, computed on here):
 *   accounts:  [{ id, name, group }]           group ∈ GROUPS ids
 *   snapshots: { 'YYYY-MM': { accountId: balance } }   month-end balances
 *   txns:      [{ id, date:'YYYY-MM-DD', name, amount, category,
 *                 account, institution }]
 * Sign convention: expenses positive, refunds negative, income positive
 * (normalized at import time by RocketMoney.toTxns).
 * ========================================================================= */
(function (global) {
    'use strict';

    /* Account groups — mirror the Net Worth sheet sections. `bucket` maps a
     * group onto the FIRE planner's buckets; cash stays its own thing — net
     * worth that the planner neither grows nor draws. */
    var GROUPS = [
        { id: 'cash',        label: 'Cash',                  side: 'asset',     investable: true, bucket: 'cash' },
        { id: 'taxFree',     label: 'Tax-Free investments',  side: 'asset',     investable: true, bucket: 'free' },
        { id: 'taxDeferred', label: 'Tax-Deferred',          side: 'asset',     investable: true, bucket: 'deferred' },
        { id: 'afterTax',    label: 'After-Tax',             side: 'asset',     investable: true, bucket: 'taxable' },
        { id: 'property',    label: 'Property',              side: 'asset' },
        { id: 'vehicle',     label: 'Vehicles',              side: 'asset' },
        { id: 'liability',   label: 'Liabilities',           side: 'liability' }
    ];

    var GROUP_BY_ID = {};
    GROUPS.forEach(function (g) { GROUP_BY_ID[g.id] = g; });

    /* Category kinds — mirror the Cashflow sheet's Fixed / Variable /
     * Spending sections, plus Saving for money deliberately set aside
     * (contributions to savings or investments — not consumption, and not a
     * neutral transfer either). Anything unlisted is discretionary Spending. */
    var KIND = {
        income:   ['Income', 'Paycheck', 'Paychecks', 'Other Income', 'Interest', 'Dividends & Capital Gains'],
        transfer: ['Transfer', 'Credit Card Payment', 'Payment', 'Buy', 'Sell',
                   'Internal Transfers', 'Deposit', 'Withdrawal', 'Cash & ATM'],
        saving:   ['Savings', 'Investments', 'Retirement Contributions', 'Savings Contribution'],
        fixed:    ['Mortgage', 'Rent', 'Insurance Payments', 'Insurance', 'Internet', 'Car Payments', 'Phone'],
        variable: ['Auto & Transport', 'Groceries', 'Gas Bill', 'Water & Light', 'Garbage', 'Utilities',
                   'Bills & Utilities', 'Fees', 'Taxes']
    };

    var KINDS = ['income', 'transfer', 'saving', 'fixed', 'variable', 'spending'];

    var KIND_LOOKUP = {};
    for (var k in KIND) KIND[k].forEach(function (c) { KIND_LOOKUP[c.toLowerCase()] = k; });

    /* User overrides (category → kind), installed by TrackerStore from the
     * Categories tab. They win over the built-in lists. */
    var KIND_OVERRIDES = {};
    function setKindOverrides(map) {
        KIND_OVERRIDES = {};
        for (var c in map || {}) {
            if (KINDS.indexOf(map[c]) !== -1) KIND_OVERRIDES[String(c).toLowerCase()] = map[c];
        }
    }

    function defaultKind(category) {
        return KIND_LOOKUP[String(category || '').toLowerCase()] || 'spending';
    }

    function categoryKind(category) {
        return KIND_OVERRIDES[String(category || '').toLowerCase()] || defaultKind(category);
    }

    /* ------------------------- month helpers ------------------------- */
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function monthKey(dateStr) {
        var m = String(dateStr || '').match(/^(\d{4})-(\d{2})/);
        if (m) return m[1] + '-' + m[2];
        var d = new Date(dateStr);
        if (isNaN(d)) return null;
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    function monthLabel(key, short) {
        var p = key.split('-');
        var name = MONTHS[Number(p[1]) - 1] || '?';
        return short ? name + ' ’' + p[0].slice(2) : name + ' ' + p[0];
    }

    function nextMonth(key) {
        var p = key.split('-');
        var y = Number(p[0]), m = Number(p[1]) + 1;
        if (m > 12) { m = 1; y++; }
        return y + '-' + String(m).padStart(2, '0');
    }

    /* ------------------------- net worth ------------------------- */
    /* series(state) → per-month totals, in snapshot month order:
     * { months, byGroup:{id:[...]}, assets, liabilities, netWorth, investable } */
    function series(state) {
        var months = Object.keys(state.snapshots).sort();
        var byGroup = {};
        GROUPS.forEach(function (g) { byGroup[g.id] = []; });
        var assets = [], liabilities = [], netWorth = [], investable = [];

        months.forEach(function (mo) {
            var bal = state.snapshots[mo];
            var groupSum = {};
            GROUPS.forEach(function (g) { groupSum[g.id] = 0; });
            state.accounts.forEach(function (a) {
                var v = Number(bal[a.id]) || 0;
                groupSum[a.group] += v;
            });
            var asset = 0, liab = 0, inv = 0;
            GROUPS.forEach(function (g) {
                byGroup[g.id].push(groupSum[g.id]);
                if (g.side === 'liability') liab += groupSum[g.id];
                else asset += groupSum[g.id];
                if (g.investable) inv += groupSum[g.id];
            });
            assets.push(asset);
            liabilities.push(liab);
            netWorth.push(asset - liab);
            investable.push(inv);
        });

        return { months: months, byGroup: byGroup, assets: assets, liabilities: liabilities, netWorth: netWorth, investable: investable };
    }

    /* buckets(state) → latest snapshot mapped onto the planner's buckets
     * (plus cash, which the planner holds outside the market). */
    function buckets(state) {
        var s = series(state);
        var n = s.months.length;
        if (!n) return null;
        var out = { deferred: 0, free: 0, taxable: 0, cash: 0 };
        GROUPS.forEach(function (g) {
            if (g.bucket) out[g.bucket] += s.byGroup[g.id][n - 1];
        });
        out.month = s.months[n - 1];
        out.netWorth = s.netWorth[n - 1];
        out.investable = s.investable[n - 1];
        return out;
    }

    /* ------------------------- expenses ------------------------- */
    /* spendByMonth(txns) → { 'YYYY-MM': { income, saving, fixed, variable,
     *   spending, expenses, saved, byCategory:{cat:amt}, count } }
     * `saved` is the surplus (income − expenses); `saving` is what was
     * explicitly marked as a savings contribution. */
    function spendByMonth(txns) {
        var out = {};
        (txns || []).forEach(function (t) {
            var mo = monthKey(t.date);
            if (!mo) return;
            // Skip transfers before creating the aggregate, so a month of
            // only transfers never materializes and cannot dilute trailing()
            var kind = categoryKind(t.category);
            if (kind === 'transfer') return;
            var agg = out[mo];
            if (!agg) agg = out[mo] = { income: 0, saving: 0, fixed: 0, variable: 0, spending: 0, expenses: 0, saved: 0, byCategory: {}, count: 0 };
            var amt = Number(t.amount) || 0;
            agg.count++;
            var cat = t.category || 'Uncategorized';
            agg.byCategory[cat] = (agg.byCategory[cat] || 0) + amt;
            if (kind === 'income') { agg.income += amt; return; }
            if (kind === 'saving') { agg.saving += amt; return; }
            agg[kind] += amt;
            agg.expenses += amt;
        });
        for (var mo in out) out[mo].saved = out[mo].income - out[mo].expenses;
        return out;
    }

    function txnMonths(txns) {
        return Object.keys(spendByMonth(txns)).sort();
    }

    /* categoryRows(agg) → Cashflow-statement rows for one month's aggregate,
     * grouped Income / Saving / Fixed / Variable / Spending, largest first
     * inside each. */
    function categoryRows(agg) {
        var sections = { income: [], saving: [], fixed: [], variable: [], spending: [] };
        for (var cat in agg.byCategory) {
            var kind = categoryKind(cat);
            if (sections[kind]) sections[kind].push({ category: cat, amount: agg.byCategory[cat] });
        }
        for (var s in sections) sections[s].sort(function (a, b) { return b.amount - a.amount; });
        return sections;
    }

    function topMerchants(txns, month, n) {
        var sums = {};
        (txns || []).forEach(function (t) {
            if (month && monthKey(t.date) !== month) return;
            var kind = categoryKind(t.category);
            if (kind === 'income' || kind === 'transfer' || kind === 'saving') return;
            var name = t.name || '?';
            sums[name] = (sums[name] || 0) + (Number(t.amount) || 0);
        });
        return Object.keys(sums)
            .map(function (name) { return { name: name, amount: sums[name] }; })
            .sort(function (a, b) { return b.amount - a.amount; })
            .slice(0, n || 8);
    }

    /* trailing(txns, span) → annualized income / expenses / savings over the
     * last `span` transaction months (default 12). When any transactions are
     * marked as savings contributions, the rate uses those actuals instead of
     * assuming the whole surplus was saved. */
    function trailing(txns, span) {
        span = span || 12;
        var byMo = spendByMonth(txns);
        var months = Object.keys(byMo).sort().slice(-span);
        if (!months.length) return null;
        var income = 0, expenses = 0, saving = 0;
        months.forEach(function (mo) { income += byMo[mo].income; expenses += byMo[mo].expenses; saving += byMo[mo].saving; });
        var scale = 12 / months.length;
        var annualIncome = income * scale, annualExpenses = expenses * scale, annualSaving = saving * scale;
        var savedAnnual = annualSaving > 0 ? annualSaving : annualIncome - annualExpenses;
        return {
            months: months.length,
            annualIncome: annualIncome,
            annualExpenses: annualExpenses,
            annualSaving: annualSaving,
            savedIsMarked: annualSaving > 0,
            savingsRate: annualIncome > 0 ? Math.max(0, savedAnnual / annualIncome) : null
        };
    }

    /* ------------------------- wealth benchmarks ------------------------- */
    /* PAW / AAW / UAW lines per The Millionaire Next Door's rule of thumb:
     *   AAW = age × income / 10; PAW = 2 × AAW; UAW = AAW / 2. */
    function benchmarks(age, income) {
        age = Number(age); income = Number(income);
        if (!age || !income) return null;
        var aaw = age * income / 10;
        return { paw: aaw * 2, aaw: aaw, uaw: aaw / 2 };
    }

    function monthDiff(from, to) {
        var a = from.split('-'), b = to.split('-');
        return (Number(b[0]) - Number(a[0])) * 12 + (Number(b[1]) - Number(a[1]));
    }

    /* Age & income for a month, resolved independently per field: an exact
     * recorded entry wins; otherwise the nearest earlier entry carries
     * forward (age advanced by elapsed years); otherwise the profile fills
     * in. Entries may hold just an income (the grid's income row) or just an
     * age. `profile` (from the shared Profile tab) overrides state.profile
     * when supplied: { birthMonth, annualIncome }. */
    function ageIncomeAt(state, mo, profile) {
        var ai = state.ageIncome || {};
        var entry = ai[mo] || {};
        var age = entry.age, income = entry.income;

        var earlier = Object.keys(ai).filter(function (k) { return k < mo; }).sort();
        for (var i = earlier.length - 1; i >= 0 && (age === undefined || income === undefined); i--) {
            var e = ai[earlier[i]];
            if (income === undefined && e.income !== undefined) income = e.income;
            if (age === undefined && e.age !== undefined) age = e.age + Math.floor(monthDiff(earlier[i], mo) / 12);
        }

        var p = profile || state.profile || {};
        if (age === undefined && p.birthMonth) age = Math.floor(monthDiff(p.birthMonth, mo) / 12);
        if (income === undefined && p.annualIncome) income = p.annualIncome;
        return age !== undefined && income !== undefined ? { age: age, income: income } : null;
    }

    /* benchmarkSeries(state, months, profile) → { paw, aaw, uaw, any } aligned to months. */
    function benchmarkSeries(state, months, profile) {
        var out = { paw: [], aaw: [], uaw: [], any: false };
        months.forEach(function (mo) {
            var e = ageIncomeAt(state, mo, profile);
            var b = e && benchmarks(e.age, e.income);
            out.paw.push(b ? b.paw : null);
            out.aaw.push(b ? b.aaw : null);
            out.uaw.push(b ? b.uaw : null);
            if (b) out.any = true;
        });
        return out;
    }

    global.TrackerEngine = {
        GROUPS: GROUPS,
        GROUP_BY_ID: GROUP_BY_ID,
        KINDS: KINDS,
        KIND: KIND,
        categoryKind: categoryKind,
        defaultKind: defaultKind,
        setKindOverrides: setKindOverrides,
        monthKey: monthKey,
        monthLabel: monthLabel,
        nextMonth: nextMonth,
        series: series,
        buckets: buckets,
        spendByMonth: spendByMonth,
        txnMonths: txnMonths,
        categoryRows: categoryRows,
        topMerchants: topMerchants,
        trailing: trailing,
        benchmarks: benchmarks,
        ageIncomeAt: ageIncomeAt,
        benchmarkSeries: benchmarkSeries
    };

})(typeof window !== 'undefined' ? window : globalThis);
