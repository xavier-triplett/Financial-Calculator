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

    var GROUP_BY_ID = Object.create(null);
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

    var KIND_LOOKUP = Object.create(null);
    for (var k in KIND) KIND[k].forEach(function (c) { KIND_LOOKUP[c.toLowerCase()] = k; });

    /* User overrides (category → kind), installed by TrackerStore from the
     * Categories tab. They win over the built-in lists. */
    var KIND_OVERRIDES = Object.create(null);
    function setKindOverrides(map) {
        KIND_OVERRIDES = Object.create(null);
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

    function validMonth(key) {
        var m = String(key || '').match(/^(\d{4})-(\d{2})$/);
        return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
    }

    function validDate(dateStr) {
        var m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return false;
        var y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
        if (mo < 1 || mo > 12 || day < 1) return false;
        return day <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
    }

    function monthKey(dateStr) {
        var raw = String(dateStr || '');
        if (!raw.trim()) return null;
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return validDate(raw.slice(0, 10)) ? raw.slice(0, 7) : null;
        var d = new Date(raw);
        if (isNaN(d)) return null;
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    function monthLabel(key, short) {
        if (!validMonth(key)) return 'Unknown month';
        var p = key.split('-');
        var name = MONTHS[Number(p[1]) - 1] || '?';
        return short ? name + ' ’' + p[0].slice(2) : name + ' ' + p[0];
    }

    function nextMonth(key) {
        if (!validMonth(key)) return null;
        var p = key.split('-');
        var y = Number(p[0]), m = Number(p[1]) + 1;
        if (m > 12) { m = 1; y++; }
        return y + '-' + String(m).padStart(2, '0');
    }

    function previousMonth(key) {
        if (!validMonth(key)) return null;
        var p = key.split('-');
        var y = Number(p[0]), m = Number(p[1]) - 1;
        if (m < 1) { m = 12; y--; }
        return y + '-' + String(m).padStart(2, '0');
    }

    function monthWindow(txns, span, coverageMonths) {
        if (span === undefined || span === null || span === '') span = 12;
        span = Number(span);
        span = Number.isFinite(span) ? Math.max(1, Math.floor(span)) : 12;
        var seen = {};
        (txns || []).forEach(function (t) {
            var mo = monthKey(t && t.date);
            if (mo) seen[mo] = true;
        });
        (coverageMonths || []).forEach(function (mo) { if (validMonth(mo)) seen[mo] = true; });
        var observed = Object.keys(seen).sort();
        if (!observed.length) return [];
        var first = observed[0], cursor = observed[observed.length - 1], out = [];
        while (cursor && cursor >= first && out.length < span) {
            out.unshift(cursor);
            cursor = previousMonth(cursor);
        }
        return out;
    }

    /* ------------------------- net worth ------------------------- */
    /* series(state) → per-month totals, in snapshot month order:
     * { months, byGroup:{id:[...]}, assets, liabilities, netWorth, investable } */
    function series(state) {
        state = state || {};
        var snapshots = state.snapshots && typeof state.snapshots === 'object' ? state.snapshots : {};
        var accounts = Array.isArray(state.accounts) ? state.accounts : [];
        var months = Object.keys(snapshots).filter(validMonth).sort();
        var byGroup = {};
        GROUPS.forEach(function (g) { byGroup[g.id] = []; });
        var assets = [], liabilities = [], netWorth = [], investable = [];

        months.forEach(function (mo) {
            var bal = snapshots[mo] && typeof snapshots[mo] === 'object' ? snapshots[mo] : {};
            var groupSum = {};
            GROUPS.forEach(function (g) { groupSum[g.id] = 0; });
            accounts.forEach(function (a) {
                if (!a || groupSum[a.group] === undefined) return;
                var v = Number(bal[a.id]);
                if (!Number.isFinite(v)) v = 0;
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
            var mo = monthKey(t && t.date);
            if (!mo) return;
            // Skip transfers before creating the aggregate, so a month of
            // only transfers never materializes and cannot dilute trailing()
            var kind = categoryKind(t && t.category);
            if (kind === 'transfer') return;
            var agg = out[mo];
            var amt = Number(t.amount);
            if (!Number.isFinite(amt)) return;
            if (!agg) agg = out[mo] = { income: 0, saving: 0, fixed: 0, variable: 0, spending: 0, expenses: 0, saved: 0, byCategory: Object.create(null), count: 0, incomeCount: 0, savingCount: 0 };
            agg.count++;
            var cat = t.category || 'Uncategorized';
            agg.byCategory[cat] = (agg.byCategory[cat] || 0) + amt;
            if (kind === 'income') { agg.income += amt; agg.incomeCount++; return; }
            if (kind === 'saving') { agg.saving += amt; agg.savingCount++; return; }
            agg[kind] += amt;
            agg.expenses += amt;
        });
        for (var mo in out) out[mo].saved = out[mo].income - out[mo].expenses;
        return out;
    }

    function txnMonths(txns) {
        var seen = {};
        (txns || []).forEach(function (t) {
            var mo = monthKey(t && t.date);
            if (mo) seen[mo] = true;
        });
        return Object.keys(seen).sort();
    }

    /* categoryRows(agg) → Cashflow-statement rows for one month's aggregate,
     * grouped Income / Saving / Fixed / Variable / Spending, largest first
     * inside each. */
    function categoryRows(agg) {
        var sections = { income: [], saving: [], fixed: [], variable: [], spending: [] };
        agg = agg || { byCategory: {} };
        for (var cat in agg.byCategory) {
            var kind = categoryKind(cat);
            if (sections[kind]) sections[kind].push({ category: cat, amount: agg.byCategory[cat] });
        }
        for (var s in sections) sections[s].sort(function (a, b) { return b.amount - a.amount; });
        return sections;
    }

    function topMerchants(txns, month, n) {
        var sums = Object.create(null);
        (txns || []).forEach(function (t) {
            if (!t || (month && monthKey(t.date) !== month)) return;
            var kind = categoryKind(t.category);
            if (kind === 'income' || kind === 'transfer' || kind === 'saving') return;
            var name = t.name || '?';
            var amount = Number(t.amount);
            if (!Number.isFinite(amount)) return;
            sums[name] = (sums[name] || 0) + amount;
        });
        return Object.keys(sums)
            .map(function (name) { return { name: name, amount: sums[name] }; })
            .sort(function (a, b) { return b.amount - a.amount; })
            .slice(0, n || 8);
    }

    /* Annualize a contiguous calendar window. Marked savings win for their
     * month; otherwise that month's income-minus-expenses surplus is used. */
    function trailing(txns, span, coverageMonths) {
        span = span || 12;
        var byMo = spendByMonth(txns);
        if (!Object.keys(byMo).length) return null;
        var months = monthWindow(txns, span, coverageMonths);
        if (!months.length) return null;
        var income = 0, expenses = 0, saving = 0, saved = 0, markedMonths = 0, activeMonths = 0;
        months.forEach(function (mo) {
            var agg = byMo[mo];
            if (!agg) return;
            activeMonths++;
            income += agg.income;
            expenses += agg.expenses;
            saving += agg.saving;
            if (agg.savingCount > 0) {
                saved += agg.saving;
                markedMonths++;
            } else {
                saved += agg.income - agg.expenses;
            }
        });
        var scale = 12 / months.length;
        var annualIncome = income * scale, annualExpenses = expenses * scale, annualSaving = saving * scale;
        var annualSaved = saved * scale;
        var savedMethod = markedMonths === 0 ? 'surplus' : markedMonths === activeMonths ? 'marked' : 'mixed';
        return {
            months: months.length,
            monthKeys: months,
            annualIncome: annualIncome,
            annualExpenses: annualExpenses,
            annualSaving: annualSaving,
            annualSaved: annualSaved,
            markedMonths: markedMonths,
            savedMethod: savedMethod,
            savedIsMarked: savedMethod === 'marked',
            savingsRate: annualIncome > 0 ? Math.max(0, annualSaved / annualIncome) : null
        };
    }

    /* ------------------------- wealth benchmarks ------------------------- */
    /* PAW / AAW / UAW lines per The Millionaire Next Door's rule of thumb:
     *   AAW = age × income / 10; PAW = 2 × AAW; UAW = AAW / 2. */
    function benchmarks(age, income) {
        age = Number(age); income = Number(income);
        if (!Number.isFinite(age) || !Number.isFinite(income) || age <= 0 || income <= 0) return null;
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
        state = state || {};
        if (!validMonth(mo)) return null;
        var ai = state.ageIncome && typeof state.ageIncome === 'object' ? state.ageIncome : {};
        var entry = ai[mo] && typeof ai[mo] === 'object' ? ai[mo] : {};
        var age = entry.age, income = entry.income;

        var earlier = Object.keys(ai).filter(function (k) { return validMonth(k) && k < mo; }).sort();
        for (var i = earlier.length - 1; i >= 0 && (age === undefined || income === undefined); i--) {
            var e = ai[earlier[i]] && typeof ai[earlier[i]] === 'object' ? ai[earlier[i]] : {};
            if (income === undefined && e.income !== undefined) income = e.income;
            if (age === undefined && e.age !== undefined) {
                var priorAge = Number(e.age);
                if (Number.isFinite(priorAge)) age = priorAge + Math.floor(monthDiff(earlier[i], mo) / 12);
            }
        }

        var p = profile || state.profile || {};
        if (age === undefined && p.birthMonth) age = Math.floor(monthDiff(p.birthMonth, mo) / 12);
        if (income === undefined && p.annualIncome) income = p.annualIncome;
        age = Number(age); income = Number(income);
        return Number.isFinite(age) && Number.isFinite(income) ? { age: age, income: income } : null;
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
        validMonth: validMonth,
        validDate: validDate,
        monthKey: monthKey,
        monthLabel: monthLabel,
        nextMonth: nextMonth,
        previousMonth: previousMonth,
        monthWindow: monthWindow,
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
