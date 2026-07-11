/* TrackerStore — two independent datasets under one key:
 * net worth (accounts + monthly snapshots + benchmark profile) for the
 * Net Worth tab, and transactions (+ manually opened months) for the
 * Cashbook. Starts blank; an optional seed.js (window.TrackerSeed) can
 * fill it. Saved data carries no compatibility guarantees. */
(function (global) {
    'use strict';

    var KEY = 'trackerData_v2';
    var E = global.TrackerEngine;

    var listeners = [];
    var state = null;
    var idCounter = 0;

    function empty() {
        return {
            accounts: [],
            snapshots: {},
            ageIncome: {},
            txns: [],
            cashMonths: []
        };
    }

    /* Accept an untrusted object only if it carries the core tracker shape;
     * otherwise start blank. Shared by localStorage load and cloud adopt. */
    function adopt(saved) {
        if (saved && saved.accounts && saved.snapshots && saved.txns) {
            return Object.assign(empty(), saved);
        }
        return empty();
    }

    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (raw) return adopt(JSON.parse(raw));
        } catch (e) { /* fall through */ }
        return empty();
    }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
    }

    function commit() { save(); listeners.forEach(function (fn) { fn(state); }); }

    function newId(prefix) {
        return prefix + Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function currentMonth() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    global.TrackerStore = {
        init: function () { state = load(); },
        get: function () { return state; },
        hasNetWorth: function () { return Object.keys(state.snapshots).length > 0; },
        hasCash: function () { return state.txns.length > 0 || state.cashMonths.length > 0; },

        /* Adopt a full tracker state from outside (a signed-in user's cloud
         * document). Caches to localStorage and notifies so the UI redraws. */
        replace: function (obj) { state = adopt(obj); commit(); },
        isEmpty: function () { return !this.hasNetWorth() && !this.hasCash() && state.accounts.length === 0; },

        /* Fill from a seed config (see seed.example.js). A seed.profile feeds
         * the shared Profile tab (birth date + income), not the tracker. */
        seedFrom: function (seed) {
            if (!seed || !seed.accounts || !seed.snapshots) return false;
            state = Object.assign(empty(), {
                accounts: seed.accounts,
                snapshots: seed.snapshots,
                ageIncome: seed.ageIncome || {},
                txns: (seed.txns || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })
            });
            if (seed.profile && global.FireStore) {
                if (seed.profile.birthMonth) global.FireStore.setProfile('birthDate', seed.profile.birthMonth + '-01');
                if (seed.profile.annualIncome) global.FireStore.setInput('income', seed.profile.annualIncome);
            }
            commit();
            return true;
        },

        reset: function () {
            localStorage.removeItem(KEY);
            state = empty();
            commit();
        },

        /* ---------- net worth: accounts ---------- */
        addAccount: function (name, group) {
            if (!E.GROUP_BY_ID[group]) return;
            var acct = { id: newId('a'), name: name || 'New account', group: group };
            state.accounts.push(acct);
            commit();
            return acct;
        },

        renameAccount: function (id, name) {
            var a = state.accounts.filter(function (a) { return a.id === id; })[0];
            if (!a || !name) return;
            a.name = name;
            commit();
        },

        removeAccount: function (id) {
            state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
            for (var mo in state.snapshots) delete state.snapshots[mo][id];
            commit();
        },

        /* ---------- net worth: snapshots ---------- */
        /* Adds the next month (or the current one when empty), carrying the
         * previous month's balances forward — the spreadsheet habit. */
        addMonth: function () {
            var months = Object.keys(state.snapshots).sort();
            var mo, base = {};
            if (months.length) {
                var last = months[months.length - 1];
                mo = E.nextMonth(last);
                base = Object.assign({}, state.snapshots[last]);
            } else {
                mo = currentMonth();
            }
            state.snapshots[mo] = base;
            commit();
            return mo;
        },

        removeMonth: function (month) {
            delete state.snapshots[month];
            commit();
        },

        setBalance: function (month, accountId, value) {
            var v = Number(value);
            if (isNaN(v) || !state.snapshots[month]) return;
            state.snapshots[month][accountId] = v;
            commit();
        },

        /* Annual income recorded against a month, for the PAW/AAW/UAW
         * benchmarks. Clearing removes the override so the month inherits
         * from earlier months or the Profile tab again. */
        setAgeIncome: function (month, income) {
            if (!/^\d{4}-\d{2}$/.test(String(month))) return;
            var v = Number(income);
            if (income === null || income === '' || isNaN(v)) {
                var entry = state.ageIncome[month];
                if (entry) {
                    delete entry.income;
                    if (Object.keys(entry).length === 0) delete state.ageIncome[month];
                }
            } else {
                state.ageIncome[month] = Object.assign({}, state.ageIncome[month], { income: v });
            }
            commit();
        },

        /* ---------- cashbook: months + transactions ---------- */
        addCashMonth: function () {
            var months = E.txnMonths(state.txns).concat(state.cashMonths).sort();
            var mo = months.length ? E.nextMonth(months[months.length - 1]) : currentMonth();
            if (state.cashMonths.indexOf(mo) === -1) state.cashMonths.push(mo);
            commit();
            return mo;
        },

        addTxn: function (t) {
            if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '') || t.amount === null || t.amount === '' || isNaN(Number(t.amount))) return null;
            var txn = {
                id: newId('m'),
                date: t.date,
                name: String(t.name || '').trim() || 'Unknown',
                amount: Math.round(Number(t.amount) * 100) / 100,
                category: String(t.category || '').trim() || 'Uncategorized',
                account: String(t.account || '').trim()
            };
            state.txns.push(txn);
            state.txns.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
            commit();
            return txn;
        },

        updateTxn: function (id, patch) {
            var t = state.txns.filter(function (t) { return t.id === id; })[0];
            if (!t) return;
            if (patch.date && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) t.date = patch.date;
            if (patch.name !== undefined) t.name = String(patch.name).trim() || t.name;
            if (patch.amount !== undefined && patch.amount !== null && !isNaN(Number(patch.amount))) t.amount = Math.round(Number(patch.amount) * 100) / 100;
            if (patch.category !== undefined) t.category = String(patch.category).trim() || 'Uncategorized';
            if (patch.account !== undefined) t.account = String(patch.account).trim();
            state.txns.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
            commit();
        },

        removeTxn: function (id) {
            state.txns = state.txns.filter(function (t) { return t.id !== id; });
            commit();
        },

        /* Merge a Rocket Money import by stable id. */
        importTxns: function (txns) {
            var seen = {};
            state.txns.forEach(function (t) { seen[t.id] = true; });
            var added = 0;
            (txns || []).forEach(function (t) {
                if (seen[t.id]) return;
                seen[t.id] = true;
                state.txns.push(t);
                added++;
            });
            state.txns.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
            commit();
            return { added: added, duplicates: (txns || []).length - added };
        },

        subscribe: function (fn) {
            listeners.push(fn);
            return function () {
                var i = listeners.indexOf(fn);
                if (i >= 0) listeners.splice(i, 1);
            };
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
