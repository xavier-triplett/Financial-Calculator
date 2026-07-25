/* UI: GOALS — monthly targets, savings goals, recurring items, and debt. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var E = global.TrackerEngine;
    var els = {};
    var month = new Date().toISOString().slice(0, 7);

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function num(value) {
        var parsed = U.parseNum(value);
        return parsed === null ? null : Number(parsed);
    }

    function template() {
        return '<div class="trk-shell goal-shell">' +
            '<header class="trk-masthead"><div>' +
                '<span class="trk-eyebrow">Intentions meet actuals</span><h1>Goals</h1>' +
                '<span class="trk-sub">Monthly targets, savings milestones, recurring items, and debt</span>' +
                '</div><div class="trk-mast-actions">' +
                    '<label class="goal-month"><span>Review month</span><input class="trk-search" type="month" data-el="month" value="' + month + '"></label>' +
                    '<button class="trk-btn" type="button" data-act="review">Monthly review</button>' +
                '</div></header><div data-el="body"></div></div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = { root: root, body: root.querySelector('[data-el="body"]'), month: root.querySelector('[data-el="month"]') };
        root.addEventListener('click', onClick);
        root.addEventListener('change', onChange);
        root.addEventListener('submit', onSubmit);
        els.month.addEventListener('change', function () {
            month = els.month.value || month;
            update(TrackerStore.get());
        });
    }

    function spentByCategory(state, selectedMonth) {
        var byMonth = E.spendByMonth(state.txns);
        var aggregate = byMonth[selectedMonth];
        return aggregate ? aggregate.byCategory : {};
    }

    function monthBefore(value) {
        var parts = value.split('-').map(Number);
        parts[1]--;
        if (parts[1] < 1) { parts[0]--; parts[1] = 12; }
        return parts[0] + '-' + String(parts[1]).padStart(2, '0');
    }

    function budgetNumbers(state, budget) {
        var actual = Number(spentByCategory(state, month)[budget.category] || 0);
        var carried = 0;
        if (budget.rollover) {
            var cursor = monthBefore(month);
            var start = budget.startMonth || month;
            var guard = 0;
            while (cursor >= start && guard++ < 36) {
                carried += budget.monthlyTarget - Number(spentByCategory(state, cursor)[budget.category] || 0);
                cursor = monthBefore(cursor);
            }
        }
        var available = budget.monthlyTarget + carried;
        return { actual: actual, available: available, remaining: available - actual };
    }

    function budgetSection(state) {
        var rows = (state.budgets || []).map(function (budget) {
            var figures = budgetNumbers(state, budget);
            var pct = figures.available > 0 ? Math.max(0, Math.min(100, figures.actual / figures.available * 100)) : 100;
            return '<article class="goal-budget-card">' +
                '<div class="goal-card-top"><div><strong>' + esc(budget.name) + '</strong><span>' + esc(budget.category) +
                    (budget.rollover ? ' · rolls over' : '') + '</span></div>' +
                    '<button class="trk-x trk-x-visible" type="button" data-del-budget="' + esc(budget.id) + '" aria-label="Delete ' + esc(budget.name) + ' budget">×</button></div>' +
                '<div class="goal-budget-values"><span><small>Available</small>' + U.compact(figures.available) + '</span>' +
                    '<span><small>Spent</small>' + U.compact(figures.actual) + '</span>' +
                    '<span class="' + (figures.remaining < 0 ? 'neg' : 'pos') + '"><small>' + (figures.remaining < 0 ? 'Over plan' : 'Remaining') + '</small>' +
                        (figures.remaining < 0 ? '−' : '') + U.compact(Math.abs(figures.remaining)) + '</span></div>' +
                '<div class="goal-bar"><span class="' + (figures.remaining < 0 ? 'over' : '') + '" style="width:' + pct.toFixed(1) + '%"></span></div>' +
                '<div class="goal-inline-fields">' +
                    '<label>Monthly target<input class="trk-search" inputmode="decimal" data-budget-id="' + esc(budget.id) + '" data-budget-field="monthlyTarget" value="' + budget.monthlyTarget + '"></label>' +
                    '<label class="goal-check"><input type="checkbox" data-budget-id="' + esc(budget.id) + '" data-budget-field="rollover"' + (budget.rollover ? ' checked' : '') + '> Carry unused amount</label>' +
                '</div></article>';
        }).join('');
        return '<section class="trk-panel goal-wide"><div class="trk-panel-head"><h2>Monthly spending plan</h2>' +
            '<span class="trk-panel-note">targets are guides, not grades</span></div>' +
            (rows ? '<div class="goal-budget-grid">' + rows + '</div>' :
                '<p class="goal-empty">Start with one category you want to make more intentional.</p>') +
            '<form class="goal-add-row" data-form="budget">' +
                '<input class="trk-search" name="name" placeholder="Budget name" aria-label="Budget name">' +
                '<input class="trk-search" name="category" placeholder="Category, e.g. Groceries" aria-label="Budget category" required>' +
                '<input class="trk-search" name="amount" inputmode="decimal" placeholder="Monthly target" aria-label="Monthly budget target" required>' +
                '<label class="goal-check"><input name="rollover" type="checkbox"> Rollover</label>' +
                '<button class="trk-btn trk-btn-primary" type="submit">Add target</button>' +
            '</form></section>';
    }

    function goalSection(state) {
        var cards = (state.savingsGoals || []).map(function (goal) {
            var pct = Math.max(0, Math.min(100, goal.currentAmount / goal.targetAmount * 100));
            return '<article class="goal-savings-card"><div class="goal-card-top">' +
                '<div><strong>' + esc(goal.name) + '</strong><span>' + (goal.targetDate ? 'Target ' + esc(goal.targetDate) : 'No deadline') + '</span></div>' +
                '<button class="trk-x trk-x-visible" type="button" data-del-goal="' + esc(goal.id) + '" aria-label="Delete ' + esc(goal.name) + ' goal">×</button></div>' +
                '<div class="goal-big-value">' + U.compact(goal.currentAmount) + ' <small>of ' + U.compact(goal.targetAmount) + '</small></div>' +
                '<div class="goal-bar"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
                '<div class="goal-inline-fields">' +
                    '<label>Saved<input class="trk-search" inputmode="decimal" data-goal-id="' + esc(goal.id) + '" data-goal-field="currentAmount" value="' + goal.currentAmount + '"></label>' +
                    '<label>Target<input class="trk-search" inputmode="decimal" data-goal-id="' + esc(goal.id) + '" data-goal-field="targetAmount" value="' + goal.targetAmount + '"></label>' +
                '</div></article>';
        }).join('');
        return '<section class="trk-panel"><div class="trk-panel-head"><h2>Savings goals</h2>' +
            '<span class="trk-panel-note">fund the life between now and retirement</span></div>' +
            (cards ? '<div class="goal-card-list">' + cards + '</div>' : '<p class="goal-empty">No goal yet. Try an emergency fund or a near-term milestone.</p>') +
            '<form class="goal-add-stack" data-form="goal">' +
                '<input class="trk-search" name="name" placeholder="Goal name" aria-label="Savings goal name" required>' +
                '<div><input class="trk-search" name="current" inputmode="decimal" placeholder="Saved now" aria-label="Amount saved now">' +
                    '<input class="trk-search" name="target" inputmode="decimal" placeholder="Target amount" aria-label="Savings target" required></div>' +
                '<input class="trk-search" name="date" type="date" aria-label="Target date">' +
                '<button class="trk-btn trk-btn-primary" type="submit">Add goal</button>' +
            '</form></section>';
    }

    function latestBalance(state, id) {
        var records = [];
        Object.keys(state.snapshots || {}).forEach(function (key) {
            if (state.snapshots[key][id] !== undefined) records.push({ date: key + '-28', value: state.snapshots[key][id] });
        });
        Object.keys(state.datedSnapshots || {}).forEach(function (key) {
            if (state.datedSnapshots[key][id] !== undefined) records.push({ date: key, value: state.datedSnapshots[key][id] });
        });
        records.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        return records.length ? Number(records[records.length - 1].value) : 0;
    }

    function payoff(balance, apr, payment) {
        if (!(balance > 0) || !(payment > 0)) return null;
        var rate = apr / 1200;
        if (!rate) return Math.ceil(balance / payment);
        if (payment <= balance * rate) return Infinity;
        return Math.ceil(-Math.log(1 - rate * balance / payment) / Math.log(1 + rate));
    }

    function debtSection(state) {
        var debts = state.accounts.filter(function (account) { return account.group === 'liability'; });
        var rows = debts.map(function (account) {
            var balance = latestBalance(state, account.id);
            var months = payoff(balance, Number(account.apr || 0), Number(account.minimumPayment || 0));
            var estimate = months === Infinity ? 'Payment does not cover monthly interest' :
                months === null ? 'Add a payment to estimate payoff' :
                (Math.floor(months / 12) ? Math.floor(months / 12) + 'y ' : '') + (months % 12) + 'm at this payment';
            return '<article class="goal-debt"><div class="goal-card-top"><div><strong>' + esc(account.name) + '</strong>' +
                '<span>' + U.compact(balance) + ' current balance · ' + estimate + '</span></div></div>' +
                '<div class="goal-inline-fields goal-debt-fields">' +
                    '<label>APR %<input class="trk-search" inputmode="decimal" data-account-id="' + esc(account.id) + '" data-account-field="apr" value="' + (account.apr || 0) + '"></label>' +
                    '<label>Monthly payment<input class="trk-search" inputmode="decimal" data-account-id="' + esc(account.id) + '" data-account-field="minimumPayment" value="' + (account.minimumPayment || 0) + '"></label>' +
                    '<label>Due day<input class="trk-search" inputmode="numeric" data-account-id="' + esc(account.id) + '" data-account-field="dueDay" value="' + (account.dueDay || '') + '"></label>' +
                    '<label>Institution<input class="trk-search" data-account-id="' + esc(account.id) + '" data-account-field="institution" value="' + esc(account.institution || '') + '"></label>' +
                '</div></article>';
        }).join('');
        return '<section class="trk-panel"><div class="trk-panel-head"><h2>Debt plan</h2>' +
            '<span class="trk-panel-note">transparent payoff estimates</span></div>' +
            (rows || '<p class="goal-empty">No liabilities are tracked. Add one here or in Net Worth.</p>') +
            '<form class="goal-add-stack" data-form="debt">' +
                '<input class="trk-search" name="name" placeholder="Debt name" aria-label="Debt account name" required>' +
                '<div><input class="trk-search" name="apr" inputmode="decimal" placeholder="APR %" aria-label="Annual percentage rate">' +
                    '<input class="trk-search" name="payment" inputmode="decimal" placeholder="Monthly payment" aria-label="Monthly payment"></div>' +
                '<button class="trk-btn" type="submit">Add debt account</button>' +
            '</form></section>';
    }

    function recurringSection(state) {
        var rows = (state.recurringTemplates || []).map(function (item) {
            var account = state.accounts.filter(function (candidate) { return candidate.id === item.accountId; })[0];
            return '<tr><td><strong>' + esc(item.name) + '</strong><small>' + esc(item.category) + '</small></td>' +
                '<td>' + esc(item.frequency) + '</td><td>' + esc(item.nextDate) + '</td>' +
                '<td>' + esc(account ? account.name : 'Unassigned') + '</td><td class="num">' + U.money(item.amount) + '</td>' +
                '<td class="goal-row-actions"><button class="trk-mini" type="button" data-post-recurring="' + esc(item.id) + '">add next</button>' +
                    '<button class="trk-x trk-x-visible" type="button" data-del-recurring="' + esc(item.id) + '" aria-label="Delete recurring item">×</button></td></tr>';
        }).join('');
        return '<section class="trk-panel goal-wide"><div class="trk-panel-head"><h2>Recurring items</h2>' +
            '<span class="trk-panel-note">a reminder list you control</span></div>' +
            (rows ? '<div class="trk-regwrap"><table class="trk-register"><caption class="trk-sr-only">Recurring transactions</caption>' +
                '<thead><tr><th>Item</th><th>Frequency</th><th>Next</th><th>Account</th><th class="num">Amount</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' :
                '<p class="goal-empty">Add rent, a subscription, a paycheck, or another repeating item.</p>') +
            '<form class="goal-add-row goal-recurring-form" data-form="recurring">' +
                '<input class="trk-search" name="name" placeholder="Name" aria-label="Recurring item name" required>' +
                '<input class="trk-search" name="amount" inputmode="decimal" placeholder="Amount" aria-label="Recurring amount" required>' +
                '<input class="trk-search" name="category" placeholder="Category" aria-label="Recurring category" required>' +
                '<select class="trk-select" name="frequency" aria-label="Frequency"><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="yearly">Yearly</option></select>' +
                '<input class="trk-search" name="date" type="date" aria-label="First date" required>' +
                '<button class="trk-btn" type="submit">Add recurring</button>' +
            '</form></section>';
    }

    function update(state) {
        els.body.innerHTML = '<div class="goal-layout">' +
            budgetSection(state) + goalSection(state) + debtSection(state) + recurringSection(state) +
            '</div>';
    }

    function formValues(form) {
        var out = {};
        Array.prototype.forEach.call(new FormData(form).entries(), function (entry) { out[entry[0]] = entry[1]; });
        return out;
    }

    function onSubmit(event) {
        var form = event.target.closest('[data-form]');
        if (!form) return;
        event.preventDefault();
        var value = formValues(form);
        var made;
        if (form.dataset.form === 'budget') {
            made = TrackerStore.addBudget({
                name: value.name || value.category, category: value.category,
                monthlyTarget: num(value.amount), rollover: !!value.rollover, startMonth: month
            });
        } else if (form.dataset.form === 'goal') {
            made = TrackerStore.addSavingsGoal({
                name: value.name, currentAmount: num(value.current) || 0,
                targetAmount: num(value.target), targetDate: value.date
            });
        } else if (form.dataset.form === 'debt') {
            made = TrackerStore.addAccount(value.name, 'liability', {
                apr: num(value.apr) || 0, minimumPayment: num(value.payment) || 0
            });
        } else if (form.dataset.form === 'recurring') {
            made = TrackerStore.addRecurringTemplate({
                name: value.name, amount: num(value.amount), category: value.category,
                frequency: value.frequency, startDate: value.date, nextDate: value.date
            });
        }
        FireApp.toast(made ? 'Saved' : 'Check the required fields');
    }

    function advanceDate(value, frequency) {
        var date = new Date(value + 'T12:00:00Z');
        if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
        else if (frequency === 'yearly') date.setUTCFullYear(date.getUTCFullYear() + 1);
        else {
            var day = date.getUTCDate();
            date.setUTCDate(1);
            date.setUTCMonth(date.getUTCMonth() + 1);
            var last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
            date.setUTCDate(Math.min(day, last));
        }
        return date.toISOString().slice(0, 10);
    }

    function onClick(event) {
        var target = event.target.closest('button');
        if (!target) return;
        if (target.dataset.delBudget) {
            FireApp.confirm('Delete this monthly target?', function () { TrackerStore.removeBudget(target.dataset.delBudget); });
        } else if (target.dataset.delGoal) {
            FireApp.confirm('Delete this savings goal?', function () { TrackerStore.removeSavingsGoal(target.dataset.delGoal); });
        } else if (target.dataset.delRecurring) {
            FireApp.confirm('Delete this recurring item?', function () { TrackerStore.removeRecurringTemplate(target.dataset.delRecurring); });
        } else if (target.dataset.postRecurring) {
            var state = TrackerStore.get();
            var item = state.recurringTemplates.filter(function (candidate) { return candidate.id === target.dataset.postRecurring; })[0];
            if (!item) return;
            var account = state.accounts.filter(function (candidate) { return candidate.id === item.accountId; })[0];
            var transaction = TrackerStore.addTxn({
                date: item.nextDate, name: item.name, amount: item.amount, category: item.category,
                accountId: item.accountId, account: account ? account.name : '', splits: item.splits
            });
            if (transaction) {
                TrackerStore.updateRecurringTemplate(item.id, { nextDate: advanceDate(item.nextDate, item.frequency) });
                FireApp.toast('Added to the Cashbook');
            }
        } else if (target.dataset.act === 'review') {
            FireApp.toast('Review balances, targets, goals, and upcoming items below');
            els.body.querySelector('.goal-budget-card, .goal-empty').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function onChange(event) {
        var target = event.target;
        if (target.dataset.budgetId) {
            var budgetPatch = {};
            budgetPatch[target.dataset.budgetField] = target.type === 'checkbox' ? target.checked : num(target.value);
            if (!TrackerStore.updateBudget(target.dataset.budgetId, budgetPatch)) FireApp.toast('Enter a valid budget value');
        } else if (target.dataset.goalId) {
            var goalPatch = {};
            goalPatch[target.dataset.goalField] = num(target.value);
            if (!TrackerStore.updateSavingsGoal(target.dataset.goalId, goalPatch)) FireApp.toast('Enter a valid goal amount');
        } else if (target.dataset.accountId) {
            var accountPatch = {};
            accountPatch[target.dataset.accountField] = target.dataset.accountField === 'institution' ? target.value : num(target.value);
            if (!TrackerStore.updateAccount(target.dataset.accountId, accountPatch)) FireApp.toast('Enter valid account details');
        }
    }

    function unmount() { els = {}; }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'goals', name: 'Goals', tag: 'Budgets, savings goals, recurring items, and debt',
        mount: mount, update: update, unmount: unmount
    });

})(window);
