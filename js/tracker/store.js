/* TrackerStore — two independent datasets under one key:
 * net worth (accounts + monthly snapshots + benchmark profile) for the
 * Net Worth tab, and transactions (+ manually opened months) for the
 * Cashbook. Starts blank; saved data carries no compatibility guarantees. */
(function (global) {
    'use strict';

    var KEY = 'trackerData_v2';
    var E = global.TrackerEngine;
    var CSV_FIELDS = { date: true, origDate: true, acctType: true, account: true, accountNumber: true,
        institution: true, name: true, customName: true, amount: true, description: true, category: true, ignored: true };

    var listeners = [];
    var state = null;
    var idCounter = 0;
    var lastSaveError = null;
    var persistenceWarned = false;

    function empty() {
        return {
            accounts: [],
            snapshots: {},
            ageIncome: {},
            txns: [],
            cashMonths: [],
            categoryKinds: {},
            csvColumns: {}
        };
    }

    function object(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function owns(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    function text(value, fallback, max) {
        var out = String(value === undefined || value === null ? '' : value).trim();
        return (out || fallback || '').slice(0, max || 500);
    }

    function finite(value) {
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
        var n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function sortTxns(a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }

    function cleanTxn(t, usedIds) {
        if (!t || !E.validDate(t.date)) return null;
        var amount = finite(t.amount);
        if (amount === null) return null;
        var id = text(t.id, '', 160) || newId('m');
        while (usedIds[id]) id = newId('m');
        usedIds[id] = true;
        var txn = {
            id: id,
            date: t.date,
            name: text(t.name, 'Unknown', 300),
            amount: Math.round(amount * 100) / 100,
            category: text(t.category, 'Uncategorized', 200),
            account: text(t.account, '', 200)
        };
        ['origDate', 'accountNumber', 'institution', 'description', 'importKey'].forEach(function (key) {
            var value = text(t[key], '', key === 'description' ? 500 : 200);
            if (value) txn[key] = value;
        });
        return txn;
    }

    /* Validate and clone persisted or cloud state at the trust boundary. */
    function adopt(saved) {
        if (!saved || typeof saved !== 'object') return empty();
        var out = empty(), ids = Object.create(null);
        (Array.isArray(saved.accounts) ? saved.accounts : []).forEach(function (a) {
            if (!a || !E.GROUP_BY_ID[a.group]) return;
            var id = text(a.id, '', 160);
            if (!id || ids[id]) return;
            ids[id] = true;
            out.accounts.push({ id: id, name: text(a.name, 'New account', 200), group: a.group });
        });

        var snapshots = object(saved.snapshots);
        Object.keys(snapshots).forEach(function (mo) {
            if (!E.validMonth(mo)) return;
            var source = object(snapshots[mo]), balances = {};
            out.accounts.forEach(function (a) {
                var value = finite(source[a.id]);
                if (value !== null) balances[a.id] = value;
            });
            out.snapshots[mo] = balances;
        });

        var ageIncome = object(saved.ageIncome);
        Object.keys(ageIncome).forEach(function (mo) {
            if (!E.validMonth(mo)) return;
            var source = object(ageIncome[mo]), entry = {};
            var age = finite(source.age), income = finite(source.income);
            if (age !== null && age >= 0) entry.age = age;
            if (income !== null && income >= 0) entry.income = income;
            if (Object.keys(entry).length) out.ageIncome[mo] = entry;
        });

        var usedTxnIds = Object.create(null);
        (Array.isArray(saved.txns) ? saved.txns : []).forEach(function (t) {
            var txn = cleanTxn(t, usedTxnIds);
            if (txn) out.txns.push(txn);
        });
        out.txns.sort(sortTxns);

        var cashSeen = Object.create(null);
        (Array.isArray(saved.cashMonths) ? saved.cashMonths : []).forEach(function (mo) {
            if (E.validMonth(mo) && !cashSeen[mo]) { cashSeen[mo] = true; out.cashMonths.push(mo); }
        });
        out.cashMonths.sort();

        var kinds = object(saved.categoryKinds), kindKeys = Object.create(null);
        Object.keys(kinds).forEach(function (category) {
            var cat = text(category, '', 200), kind = kinds[category];
            if (!cat || E.KINDS.indexOf(kind) === -1 || kind === E.defaultKind(cat)) return;
            var key = cat.toLowerCase();
            if (kindKeys[key]) delete out.categoryKinds[kindKeys[key]];
            kindKeys[key] = cat;
            out.categoryKinds[cat] = kind;
        });

        var columns = object(saved.csvColumns);
        Object.keys(columns).forEach(function (field) {
            if (!owns(CSV_FIELDS, field)) return;
            var header = text(columns[field], '', 200);
            if (header) out.csvColumns[field] = header;
        });
        return out;
    }

    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (raw) return adopt(JSON.parse(raw));
        } catch (e) { /* fall through */ }
        return empty();
    }

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(state));
            lastSaveError = null;
            persistenceWarned = false;
            return true;
        } catch (e) {
            lastSaveError = (e && e.message) || 'Browser storage is unavailable';
            if (!persistenceWarned && global.FireApp && FireApp.toast) {
                persistenceWarned = true;
                FireApp.toast('Tracker changes are only in memory — browser storage failed');
            }
            return false;
        }
    }

    function commit() {
        E.setKindOverrides(state.categoryKinds);
        var persisted = save();
        listeners.slice().forEach(function (fn) {
            try { fn(state); } catch (e) { if (global.console && console.error) console.error(e); }
        });
        return persisted;
    }

    function newId(prefix) {
        return prefix + Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function currentMonth() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    global.TrackerStore = {
        init: function () { state = load(); E.setKindOverrides(state.categoryKinds); },
        get: function () { return state; },
        persistenceError: function () { return lastSaveError; },
        hasNetWorth: function () { return Object.keys(state.snapshots).length > 0; },
        hasCash: function () { return state.txns.length > 0 || state.cashMonths.length > 0; },

        /* Adopt a full tracker state from outside (a signed-in user's cloud
         * document). Caches to localStorage and notifies so the UI redraws. */
        replace: function (obj) { state = adopt(obj); commit(); },
        isEmpty: function () {
            return !this.hasNetWorth() && !this.hasCash() && state.accounts.length === 0 &&
                Object.keys(state.ageIncome).length === 0 && Object.keys(state.categoryKinds).length === 0 &&
                Object.keys(state.csvColumns).length === 0;
        },

        /* Import structured tracker data without replacing the other domain. */
        seedFrom: function (seed, scope) {
            if (!seed || typeof seed !== 'object') return false;
            if (scope === 'networth' && (!Array.isArray(seed.accounts) || !seed.snapshots)) return false;
            if (scope === 'cashflow' && !Array.isArray(seed.txns) && !Array.isArray(seed.cashMonths)) return false;
            var incoming = adopt({
                accounts: seed.accounts || [],
                snapshots: seed.snapshots || {},
                ageIncome: seed.ageIncome || {},
                txns: seed.txns || [],
                cashMonths: seed.cashMonths || []
            });
            if (scope === 'networth') {
                state.accounts = incoming.accounts;
                state.snapshots = incoming.snapshots;
                state.ageIncome = incoming.ageIncome;
            } else if (scope === 'cashflow') {
                state.txns = incoming.txns;
                state.cashMonths = incoming.cashMonths;
            } else {
                if (!this.hasNetWorth()) {
                    state.accounts = incoming.accounts;
                    state.snapshots = incoming.snapshots;
                    state.ageIncome = incoming.ageIncome;
                }
                if (!this.hasCash()) {
                    state.txns = incoming.txns;
                    state.cashMonths = incoming.cashMonths;
                }
            }
            if (scope !== 'cashflow' && seed.profile && global.FireStore) {
                if (seed.profile.birthMonth) global.FireStore.setProfile('birthDate', seed.profile.birthMonth + '-01');
                if (seed.profile.annualIncome) global.FireStore.setInput('income', seed.profile.annualIncome);
            }
            commit();
            return true;
        },

        reset: function () {
            state = empty();
            return commit();
        },

        resetNetWorth: function () {
            state.accounts = [];
            state.snapshots = {};
            state.ageIncome = {};
            return commit();
        },

        resetCash: function () {
            state.txns = [];
            state.cashMonths = [];
            return commit();
        },

        /* ---------- net worth: accounts ---------- */
        addAccount: function (name, group) {
            if (!E.GROUP_BY_ID[group]) return;
            var acct = { id: newId('a'), name: text(name, 'New account', 200), group: group };
            state.accounts.push(acct);
            commit();
            return acct;
        },

        renameAccount: function (id, name) {
            var a = state.accounts.filter(function (a) { return a.id === id; })[0];
            var next = text(name, '', 200);
            if (!a || !next) return false;
            a.name = next;
            commit();
            return true;
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
            if (!E.validMonth(month)) return false;
            delete state.snapshots[month];
            commit();
            return true;
        },

        setBalance: function (month, accountId, value) {
            var v = finite(value);
            var account = state.accounts.some(function (a) { return a.id === accountId; });
            if (v === null || !account || !E.validMonth(month) || !owns(state.snapshots, month)) return false;
            state.snapshots[month][accountId] = v;
            commit();
            return true;
        },

        /* Annual income recorded against a month, for the PAW/AAW/UAW
         * benchmarks. Clearing removes the override so the month inherits
         * from earlier months or the Profile tab again. */
        setAgeIncome: function (month, income) {
            if (!E.validMonth(month)) return false;
            var v = finite(income);
            if (income === null || income === '') {
                var entry = state.ageIncome[month];
                if (entry) {
                    delete entry.income;
                    if (Object.keys(entry).length === 0) delete state.ageIncome[month];
                }
            } else {
                if (v === null || v < 0) return false;
                state.ageIncome[month] = Object.assign({}, state.ageIncome[month], { income: v });
            }
            commit();
            return true;
        },

        /* ---------- cashbook: months + transactions ---------- */
        addCashMonth: function () {
            var months = E.txnMonths(state.txns).concat(state.cashMonths).sort();
            var mo = months.length ? E.nextMonth(months[months.length - 1]) : currentMonth();
            if (!mo) mo = currentMonth();
            if (state.cashMonths.indexOf(mo) === -1) state.cashMonths.push(mo);
            state.cashMonths.sort();
            commit();
            return mo;
        },

        /* Delete a cashbook month: its transactions and its open-page marker. */
        removeCashMonth: function (month) {
            if (!E.validMonth(month)) return false;
            state.cashMonths = state.cashMonths.filter(function (mo) { return mo !== month; });
            state.txns = state.txns.filter(function (t) { return E.monthKey(t.date) !== month; });
            commit();
            return true;
        },

        addTxn: function (t) {
            var amount = t && finite(t.amount);
            if (!t || !E.validDate(t.date) || amount === null) return null;
            var txn = {
                id: newId('m'),
                date: t.date,
                name: text(t.name, 'Unknown', 300),
                amount: Math.round(amount * 100) / 100,
                category: text(t.category, 'Uncategorized', 200),
                account: text(t.account, '', 200)
            };
            state.txns.push(txn);
            state.txns.sort(sortTxns);
            commit();
            return txn;
        },

        updateTxn: function (id, patch) {
            var t = state.txns.filter(function (t) { return t.id === id; })[0];
            if (!t || !patch) return false;
            if (patch.date !== undefined && !E.validDate(patch.date)) return false;
            if (patch.amount !== undefined && finite(patch.amount) === null) return false;
            if (patch.date !== undefined) t.date = patch.date;
            if (patch.name !== undefined) t.name = text(patch.name, t.name, 300);
            if (patch.amount !== undefined) t.amount = Math.round(finite(patch.amount) * 100) / 100;
            if (patch.category !== undefined) t.category = text(patch.category, 'Uncategorized', 200);
            if (patch.account !== undefined) t.account = text(patch.account, '', 200);
            state.txns.sort(sortTxns);
            commit();
            return true;
        },

        removeTxn: function (id) {
            state.txns = state.txns.filter(function (t) { return t.id !== id; });
            commit();
        },

        /* ---------- configuration: category kinds + CSV columns ---------- */
        /* Override a category's kind. Passing the built-in default (or '')
         * clears the override so the category follows the built-ins again. */
        setCategoryKind: function (category, kind) {
            var cat = text(category, '', 200);
            if (!cat || E.KINDS.indexOf(kind) === -1) return false;
            var folded = cat.toLowerCase();
            Object.keys(state.categoryKinds).forEach(function (existing) {
                if (existing.toLowerCase() === folded) delete state.categoryKinds[existing];
            });
            if (kind !== E.defaultKind(cat)) state.categoryKinds[cat] = kind;
            commit();
            return true;
        },

        /* Point an importer field at a differently-named CSV column.
         * Blank restores the built-in header aliases. */
        setCsvColumn: function (field, header) {
            if (!owns(CSV_FIELDS, field)) return false;
            var h = text(header, '', 200);
            if (h) state.csvColumns[field] = h;
            else delete state.csvColumns[field];
            commit();
            return true;
        },

        /* Merge imported rows as a multiset so exact purchases are preserved. */
        importTxns: function (txns) {
            var seenIds = Object.create(null), existingCounts = Object.create(null), incomingCounts = Object.create(null);
            state.txns.forEach(function (t) {
                seenIds[t.id] = true;
                if (t.importKey) existingCounts[t.importKey] = (existingCounts[t.importKey] || 0) + 1;
            });
            var added = 0, duplicates = 0;
            var incoming = Array.isArray(txns) ? txns : [];
            incoming.forEach(function (t) {
                var key = t && text(t.importKey, '', 200);
                if (!key || !E.validDate(t.date) || finite(t.amount) === null) return;
                incomingCounts[key] = (incomingCounts[key] || 0) + 1;
                if (incomingCounts[key] <= (existingCounts[key] || 0)) { duplicates++; return; }
                var source = Object.assign({}, t, { importKey: key });
                var copy = cleanTxn(source, seenIds);
                if (!copy) return;
                state.txns.push(copy);
                added++;
            });
            state.txns.sort(sortTxns);
            var persisted = added ? commit() : !lastSaveError;
            return { added: added, duplicates: duplicates, rejected: incoming.length - added - duplicates, persisted: persisted };
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
