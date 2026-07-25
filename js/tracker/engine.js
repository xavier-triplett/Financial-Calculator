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

    function monthEndDate(key) {
        if (!validMonth(key)) return null;
        var p = key.split('-');
        var day = new Date(Date.UTC(Number(p[0]), Number(p[1]), 0)).getUTCDate();
        return key + '-' + String(day).padStart(2, '0');
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
    function latestBalances(state, throughDate) {
        state = state || {};
        var events = [];
        var monthly = state.snapshots && typeof state.snapshots === 'object' ? state.snapshots : {};
        var dated = state.datedSnapshots && typeof state.datedSnapshots === 'object' ? state.datedSnapshots : {};
        Object.keys(monthly).forEach(function (month) {
            var date = monthEndDate(month);
            if (date && (!throughDate || date <= throughDate)) events.push({ date: date, balances: monthly[month] });
        });
        Object.keys(dated).forEach(function (date) {
            if (validDate(date) && (!throughDate || date <= throughDate)) events.push({ date: date, balances: dated[date] });
        });
        events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        if (!events.length) return null;
        var balances = {};
        events.forEach(function (event) {
            var source = event.balances && typeof event.balances === 'object' ? event.balances : {};
            Object.keys(source).forEach(function (id) {
                var value = Number(source[id]);
                if (Number.isFinite(value)) balances[id] = value;
            });
        });
        return { asOfDate: events[events.length - 1].date, balances: balances };
    }

    function buckets(state) {
        state = state || {};
        var latest = latestBalances(state);
        if (!latest) return null;
        var accounts = Array.isArray(state.accounts) ? state.accounts : [];
        var out = { deferred: 0, free: 0, taxable: 0, cash: 0 };
        var assets = 0, liabilities = 0, investable = 0;
        accounts.forEach(function (account) {
            var group = account && GROUP_BY_ID[account.group];
            if (!group) return;
            var value = Number(latest.balances[account.id]);
            if (!Number.isFinite(value)) value = 0;
            if (group.side === 'liability') liabilities += value;
            else assets += value;
            if (group.investable) investable += value;
            if (group.bucket) out[group.bucket] += value;
        });
        out.month = latest.asOfDate.slice(0, 7);
        out.asOfDate = latest.asOfDate;
        out.netWorth = assets - liabilities;
        out.investable = investable;
        return out;
    }

    /* ------------------------- expenses ------------------------- */
    /* spendByMonth(txns) → { 'YYYY-MM': { income, saving, fixed, variable,
     *   spending, expenses, saved, byCategory:{cat:amt}, count } }
     * `saved` is the surplus (income − expenses); `saving` is what was
     * explicitly marked as a savings contribution. */
    /* Split transactions contribute their parts instead of their parent
     * category. Invalid external split data safely falls back to the parent. */
    function txnParts(txn) {
        var amount = Number(txn && txn.amount);
        if (!Number.isFinite(amount)) return [];
        var splits = txn && Array.isArray(txn.splits) ? txn.splits : null;
        if (!splits || !splits.length || splits.length > 100) {
            return [{ category: txn && txn.category || 'Uncategorized', amount: amount }];
        }
        var out = [], cents = 0;
        for (var i = 0; i < splits.length; i++) {
            var partAmount = Number(splits[i] && splits[i].amount);
            var category = String(splits[i] && splits[i].category || '').trim();
            if (!Number.isFinite(partAmount) || !category) {
                return [{ category: txn && txn.category || 'Uncategorized', amount: amount }];
            }
            cents += Math.round(partAmount * 100);
            out.push({ category: category, amount: partAmount });
        }
        return cents === Math.round(amount * 100)
            ? out
            : [{ category: txn && txn.category || 'Uncategorized', amount: amount }];
    }

    function spendByMonth(txns) {
        var out = {};
        (txns || []).forEach(function (t) {
            var mo = monthKey(t && t.date);
            if (!mo) return;
            var material = txnParts(t).filter(function (part) {
                return categoryKind(part.category) !== 'transfer';
            });
            // Transfer-only transactions remain calendar coverage through
            // txnMonths(), but do not create a statement aggregate.
            if (!material.length) return;
            var agg = out[mo];
            if (!agg) agg = out[mo] = { income: 0, saving: 0, fixed: 0, variable: 0, spending: 0, expenses: 0, saved: 0, byCategory: Object.create(null), count: 0, incomeCount: 0, savingCount: 0 };
            agg.count++;
            material.forEach(function (part) {
                var kind = categoryKind(part.category);
                agg.byCategory[part.category] = (agg.byCategory[part.category] || 0) + part.amount;
                if (kind === 'income') {
                    agg.income += part.amount;
                    agg.incomeCount++;
                } else if (kind === 'saving') {
                    agg.saving += part.amount;
                    agg.savingCount++;
                } else {
                    agg[kind] += part.amount;
                    agg.expenses += part.amount;
                }
            });
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
            var name = t.name || '?';
            txnParts(t).forEach(function (part) {
                var kind = categoryKind(part.category);
                if (kind === 'income' || kind === 'transfer' || kind === 'saving') return;
                sums[name] = (sums[name] || 0) + part.amount;
            });
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

    /* ------------------------- budgets ------------------------- */
    function categoryAmount(aggregate, category) {
        var target = String(category || '').toLowerCase();
        var total = 0;
        var byCategory = aggregate && aggregate.byCategory || {};
        Object.keys(byCategory).forEach(function (name) {
            if (name.toLowerCase() === target) total += Number(byCategory[name]) || 0;
        });
        return total;
    }

    function budgetRollover(budget, txns, month) {
        budget = budget || {};
        if (!validMonth(month)) return null;
        var target = Number(budget.monthlyTarget !== undefined ? budget.monthlyTarget : budget.amount);
        if (!Number.isFinite(target) || target < 0 || !String(budget.category || '').trim()) return null;
        var start = validMonth(budget.startMonth) ? budget.startMonth : month;
        var end = validMonth(budget.endMonth) ? budget.endMonth : null;
        if (month < start || (end && month > end)) {
            return {
                budgetId: budget.id || null,
                category: budget.category,
                month: month,
                active: false,
                target: 0,
                carryIn: 0,
                available: 0,
                actual: 0,
                remaining: 0
            };
        }
        var distance = monthDiff(start, month);
        if (distance < 0 || distance > 1200) return null;
        var byMonth = spendByMonth(txns);
        var cursor = start, carry = 0, row = null;
        for (var i = 0; i <= distance; i++) {
            var carryIn = budget.rollover === true ? carry : 0;
            var actual = categoryAmount(byMonth[cursor], budget.category);
            var available = target + carryIn;
            var remaining = available - actual;
            row = {
                budgetId: budget.id || null,
                name: budget.name || budget.category,
                category: budget.category,
                month: cursor,
                active: true,
                target: target,
                carryIn: carryIn,
                available: available,
                actual: actual,
                remaining: remaining,
                rollover: budget.rollover === true
            };
            carry = budget.rollover === true ? remaining : 0;
            cursor = nextMonth(cursor);
        }
        return row;
    }

    function budgetVsActual(state, month) {
        state = state || {};
        var txns = Array.isArray(state.txns) ? state.txns : [];
        if (!validMonth(month)) {
            var observed = txnMonths(txns).concat(Array.isArray(state.cashMonths) ? state.cashMonths.filter(validMonth) : []).sort();
            month = observed.length ? observed[observed.length - 1] : new Date().toISOString().slice(0, 7);
        }
        var budgets = Array.isArray(state.budgets) ? state.budgets : [];
        var rows = budgets.map(function (budget) {
            return budgetRollover(budget, txns, month);
        }).filter(function (row) { return row && row.active; });
        return {
            month: month,
            rows: rows,
            totalTarget: rows.reduce(function (sum, row) { return sum + row.target; }, 0),
            totalCarryIn: rows.reduce(function (sum, row) { return sum + row.carryIn; }, 0),
            totalAvailable: rows.reduce(function (sum, row) { return sum + row.available; }, 0),
            totalActual: rows.reduce(function (sum, row) { return sum + row.actual; }, 0),
            totalRemaining: rows.reduce(function (sum, row) { return sum + row.remaining; }, 0)
        };
    }

    /* ------------------------- debt ------------------------- */
    function addMonthsToDate(date, months) {
        if (!validDate(date)) return null;
        var p = date.split('-');
        var year = Number(p[0]), month = Number(p[1]) - 1, day = Number(p[2]);
        var target = new Date(Date.UTC(year, month + months, 1));
        var lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        target.setUTCDate(Math.min(day, lastDay));
        return target.toISOString().slice(0, 10);
    }

    /* Preferred signature: (account, balance, extraPayment, startDate).
     * Also accepts ({ balance, apr, minimumPayment }, extraPayment, startDate)
     * or (balance, apr, monthlyPayment, extraPayment, startDate). */
    function debtPayoffEstimate(accountOrBalance, balanceOrApr, extraOrPayment, maybeExtra, maybeStart) {
        var principal, apr, payment, extra, startDate;
        if (accountOrBalance && typeof accountOrBalance === 'object') {
            apr = Number(accountOrBalance.apr !== undefined ? accountOrBalance.apr : accountOrBalance.aprPercent);
            payment = Number(accountOrBalance.minimumPayment);
            if (Number.isFinite(Number(accountOrBalance.balance))) {
                principal = Number(accountOrBalance.balance);
                extra = Number(balanceOrApr) || 0;
                startDate = extraOrPayment;
            } else {
                principal = Number(balanceOrApr);
                extra = Number(extraOrPayment) || 0;
                startDate = maybeExtra;
            }
        } else {
            principal = Number(accountOrBalance);
            apr = Number(balanceOrApr);
            payment = Number(extraOrPayment);
            extra = Number(maybeExtra) || 0;
            startDate = maybeStart;
        }
        principal = Math.abs(principal);
        if (!Number.isFinite(principal) || !Number.isFinite(apr) || apr < 0 || apr > 100 ||
            !Number.isFinite(payment) || payment < 0 || !Number.isFinite(extra) || extra < 0) return null;
        var monthlyPayment = payment + extra;
        if (principal === 0) {
            return { payoffPossible: true, months: 0, totalPaid: 0, totalInterest: 0,
                monthlyPayment: monthlyPayment, payoffDate: validDate(startDate) ? startDate : null };
        }
        var monthlyRate = apr / 100 / 12;
        if (monthlyPayment <= principal * monthlyRate + 1e-9) {
            return { payoffPossible: false, reason: 'negative-amortization', months: null,
                totalPaid: null, totalInterest: null, monthlyPayment: monthlyPayment, payoffDate: null };
        }
        var balance = principal, totalPaid = 0, totalInterest = 0, months = 0;
        while (balance > 0.005 && months < 1200) {
            var interest = balance * monthlyRate;
            var due = balance + interest;
            var paid = Math.min(monthlyPayment, due);
            balance = due - paid;
            totalPaid += paid;
            totalInterest += interest;
            months++;
        }
        if (balance > 0.005) {
            return { payoffPossible: false, reason: 'term-exceeds-limit', months: null,
                totalPaid: null, totalInterest: null, monthlyPayment: monthlyPayment, payoffDate: null };
        }
        return {
            payoffPossible: true,
            months: months,
            totalPaid: Math.round(totalPaid * 100) / 100,
            totalInterest: Math.round(totalInterest * 100) / 100,
            monthlyPayment: Math.round(monthlyPayment * 100) / 100,
            payoffDate: validDate(startDate) ? addMonthsToDate(startDate, months) : null
        };
    }

    /* ------------------------- freshness and plan bridge ------------------------- */
    function latestAccountDate(state, accountId) {
        var latest = null;
        var account = (Array.isArray(state.accounts) ? state.accounts : []).filter(function (candidate) {
            return candidate && candidate.id === accountId;
        })[0];
        var explicit = account && account.freshness && account.freshness.asOf;
        if (validDate(explicit)) latest = explicit;
        var dated = state.datedSnapshots && typeof state.datedSnapshots === 'object' ? state.datedSnapshots : {};
        Object.keys(dated).forEach(function (date) {
            if (validDate(date) && dated[date] && Number.isFinite(Number(dated[date][accountId])) &&
                (!latest || date > latest)) latest = date;
        });
        var monthly = state.snapshots && typeof state.snapshots === 'object' ? state.snapshots : {};
        Object.keys(monthly).forEach(function (month) {
            var date = monthEndDate(month);
            if (date && monthly[month] && Number.isFinite(Number(monthly[month][accountId])) &&
                (!latest || date > latest)) latest = date;
        });
        return latest;
    }

    function dataFreshness(state, options) {
        state = state || {};
        if (typeof options === 'string') options = { asOfDate: options };
        options = options || {};
        var reference = validDate(options.asOfDate) ? options.asOfDate : new Date().toISOString().slice(0, 10);
        var threshold = Number(options.staleAfterDays);
        threshold = Number.isFinite(threshold) && threshold >= 1 ? Math.floor(threshold) : 45;
        var referenceTime = Date.parse(reference + 'T00:00:00Z');
        var rows = (Array.isArray(state.accounts) ? state.accounts : []).map(function (account) {
            var asOf = latestAccountDate(state, account.id);
            var ageDays = asOf ? Math.max(0, Math.floor((referenceTime - Date.parse(asOf + 'T00:00:00Z')) / 86400000)) : null;
            return {
                id: account.id,
                name: account.name,
                asOf: asOf,
                ageDays: ageDays,
                status: !asOf ? 'missing' : ageDays > threshold ? 'stale' : 'fresh',
                source: account.freshness && account.freshness.source || 'manual'
            };
        });
        var stale = rows.filter(function (row) { return row.status === 'stale'; }).length;
        var missing = rows.filter(function (row) { return row.status === 'missing'; }).length;
        var dates = rows.map(function (row) { return row.asOf; }).filter(Boolean).sort();
        return {
            asOfDate: reference,
            staleAfterDays: threshold,
            status: missing ? 'missing' : stale ? 'stale' : rows.length ? 'fresh' : 'empty',
            accounts: rows,
            fresh: rows.length - stale - missing,
            stale: stale,
            missing: missing,
            oldestAsOf: dates.length ? dates[0] : null,
            newestAsOf: dates.length ? dates[dates.length - 1] : null
        };
    }

    function planVsActualInputs(state, options) {
        state = state || {};
        options = options || {};
        var balanceData = buckets(state);
        var cashflow = trailing(state.txns || [], options.span || 12, state.cashMonths || []);
        var inputs = {};
        if (balanceData) {
            inputs.balDeferred = balanceData.deferred;
            inputs.balFree = balanceData.free;
            inputs.balTaxable = balanceData.taxable;
            inputs.balCash = balanceData.cash;
        }
        if (cashflow) {
            var taxRate = Number(options.incomeTaxRate) || 0;
            var keep = 1 - Math.max(0, Math.min(100, taxRate)) / 100;
            var grossIncome = keep > 0 ? cashflow.annualIncome / keep : cashflow.annualIncome;
            inputs.expenses = cashflow.annualExpenses;
            if (cashflow.annualIncome > 0 && cashflow.months >= (options.minimumIncomeMonths || 3)) {
                inputs.income = grossIncome;
                inputs.savingsRate = grossIncome > 0 ? Math.max(0, cashflow.annualSaved / grossIncome) * 100 : 0;
            }
        }
        var txnMonthKeys = txnMonths(state.txns || []);
        var balanceMonth = balanceData && balanceData.month;
        var transactionMonth = txnMonthKeys.length ? txnMonthKeys[txnMonthKeys.length - 1] : null;
        return {
            asOfMonth: balanceMonth && transactionMonth
                ? (balanceMonth > transactionMonth ? balanceMonth : transactionMonth)
                : balanceMonth || transactionMonth || null,
            coverageMonths: cashflow ? cashflow.months : 0,
            inputs: inputs,
            buckets: balanceData,
            cashflow: cashflow,
            freshness: dataFreshness(state, options.freshness || {})
        };
    }

    function matchMerchantRule(transaction, rules) {
        var merchant = String(transaction && transaction.name || '');
        var accountId = String(transaction && transaction.accountId || '');
        return (Array.isArray(rules) ? rules.slice() : [])
            .filter(function (rule) { return rule && rule.enabled !== false; })
            .sort(function (a, b) { return (Number(b.priority) || 0) - (Number(a.priority) || 0); })
            .filter(function (rule) {
                if (rule.accountId && rule.accountId !== accountId) return false;
                var needle = String(rule.match || '').toLowerCase();
                var value = merchant.toLowerCase();
                if (!needle) return false;
                if (rule.mode === 'equals') return value === needle;
                if (rule.mode === 'startsWith') return value.indexOf(needle) === 0;
                return value.indexOf(needle) !== -1;
            })[0] || null;
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
        monthEndDate: monthEndDate,
        monthWindow: monthWindow,
        series: series,
        latestBalances: latestBalances,
        buckets: buckets,
        txnParts: txnParts,
        spendByMonth: spendByMonth,
        txnMonths: txnMonths,
        categoryRows: categoryRows,
        topMerchants: topMerchants,
        trailing: trailing,
        budgetRollover: budgetRollover,
        rollover: budgetRollover,
        budgetVsActual: budgetVsActual,
        debtPayoffEstimate: debtPayoffEstimate,
        dataFreshness: dataFreshness,
        planVsActualInputs: planVsActualInputs,
        matchMerchantRule: matchMerchantRule,
        benchmarks: benchmarks,
        ageIncomeAt: ageIncomeAt,
        benchmarkSeries: benchmarkSeries
    };

})(typeof window !== 'undefined' ? window : globalThis);
