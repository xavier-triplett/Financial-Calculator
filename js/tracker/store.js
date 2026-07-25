/* TrackerStore - validated, versioned persistence for net worth and cashbook data. */
(function (global) {
    'use strict';

    var SCHEMA_VERSION = 4;
    var KEY = 'trackerData_v4';
    var LEGACY_KEYS = [];
    var UNDO_LIMIT = 25;
    var E = global.TrackerEngine;
    var CSV_FIELDS = { date: true, origDate: true, acctType: true, account: true, accountNumber: true,
        institution: true, name: true, customName: true, amount: true, description: true, category: true, ignored: true };

    var listeners = [];
    var state = null;
    var idCounter = 0;
    var lastSaveError = null;
    var persistenceWarned = false;
    var undoStack = [];

    function empty() {
        var now = new Date().toISOString();
        return {
            schemaVersion: SCHEMA_VERSION,
            meta: { createdAt: now, updatedAt: now },
            accounts: [],
            snapshots: {},
            datedSnapshots: {},
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

    function money(value) {
        var n = finite(value);
        return n === null ? null : Math.round(n * 100) / 100;
    }

    function nonnegative(value) {
        var n = money(value);
        return n !== null && n >= 0 ? n : null;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function timestamp(value) {
        if (value === undefined || value === null || value === '') return '';
        var d = new Date(value);
        return isNaN(d.getTime()) ? '' : d.toISOString();
    }

    function currentMonth() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    function monthEnd(month) {
        if (!E.validMonth(month)) return '';
        var p = month.split('-');
        var day = new Date(Date.UTC(Number(p[0]), Number(p[1]), 0)).getUTCDate();
        return month + '-' + String(day).padStart(2, '0');
    }

    function currency(value) {
        var code = text(value, 'USD', 3).toUpperCase();
        return /^[A-Z]{3}$/.test(code) ? code : 'USD';
    }

    function newId(prefix) {
        return prefix + Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function uniqueId(value, prefix, used) {
        var id = text(value, '', 160) || newId(prefix);
        while (used[id]) id = newId(prefix);
        used[id] = true;
        return id;
    }

    function cleanFreshness(value) {
        var source = object(value);
        var out = { source: text(source.source, 'manual', 80) };
        var asOf = text(source.asOf || source.asOfDate, '', 10);
        var updatedAt = timestamp(source.updatedAt || source.lastUpdatedAt || source.lastSyncedAt);
        if (E.validDate(asOf)) out.asOf = asOf;
        if (updatedAt) out.updatedAt = updatedAt;
        return out;
    }

    function cleanAccount(account, usedIds) {
        if (!account || !E.GROUP_BY_ID[account.group]) return null;
        var out = {
            id: uniqueId(account.id, 'a', usedIds),
            name: text(account.name, 'New account', 200),
            group: account.group,
            institution: text(account.institution, '', 200),
            currency: currency(account.currency),
            freshness: cleanFreshness(account.freshness)
        };
        if (out.group === 'liability') {
            var terms = object(account.liability);
            var apr = finite(account.apr !== undefined ? account.apr : terms.apr);
            var payment = nonnegative(account.minimumPayment !== undefined ? account.minimumPayment : terms.minimumPayment);
            var dueDay = finite(account.dueDay !== undefined ? account.dueDay : terms.dueDay);
            if (apr !== null && apr >= 0 && apr <= 100) out.apr = Math.round(apr * 1000) / 1000;
            if (payment !== null) out.minimumPayment = payment;
            if (dueDay !== null && dueDay >= 1 && dueDay <= 31) out.dueDay = Math.round(dueDay);
        }
        return out;
    }

    function accountMap(accounts) {
        var out = Object.create(null);
        accounts.forEach(function (account) { out[account.id] = account; });
        return out;
    }

    function cleanBalances(source, accountsById) {
        source = object(source);
        var out = {};
        Object.keys(source).forEach(function (id) {
            var value = money(source[id]);
            if (accountsById[id] && value !== null) out[id] = value;
        });
        return out;
    }

    function splitResult(splits, amount) {
        if (splits === undefined || splits === null || (Array.isArray(splits) && !splits.length)) {
            return { valid: true, value: undefined };
        }
        if (!Array.isArray(splits) || splits.length > 100) return { valid: false };
        var out = [], totalCents = 0;
        for (var i = 0; i < splits.length; i++) {
            var source = splits[i];
            var partAmount = source && money(source.amount);
            var category = source && text(source.category, '', 200);
            if (!source || partAmount === null || !category) return { valid: false };
            var part = { category: category, amount: partAmount };
            var note = text(source.note || source.memo, '', 300);
            if (note) part.note = note;
            out.push(part);
            totalCents += Math.round(partAmount * 100);
        }
        return { valid: totalCents === Math.round(amount * 100), value: out };
    }

    function sortTxns(a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }

    function cleanTxn(transaction, usedIds, accountsById) {
        if (!transaction || !E.validDate(transaction.date)) return null;
        var amount = money(transaction.amount);
        if (amount === null) return null;
        var splits = splitResult(transaction.splits, amount);
        var out = {
            id: uniqueId(transaction.id, 'm', usedIds),
            date: transaction.date,
            name: text(transaction.name, 'Unknown', 300),
            amount: amount,
            category: text(transaction.category, 'Uncategorized', 200),
            account: text(transaction.account, '', 200),
            accountId: accountsById[text(transaction.accountId, '', 160)] ? text(transaction.accountId, '', 160) : ''
        };
        ['origDate', 'accountNumber', 'institution', 'description', 'importKey'].forEach(function (key) {
            var value = text(transaction[key], '', key === 'description' ? 500 : 200);
            if (value) out[key] = value;
        });
        if (splits.valid && splits.value) out.splits = splits.value;
        return out;
    }

    /* Validate and clone persisted, imported, or cloud state at the trust boundary. */
    function adopt(saved) {
        if (!saved || typeof saved !== 'object') return empty();
        var out = empty();
        var savedMeta = object(saved.meta);
        var createdAt = timestamp(savedMeta.createdAt);
        var updatedAt = timestamp(savedMeta.updatedAt);
        if (createdAt) out.meta.createdAt = createdAt;
        if (updatedAt) out.meta.updatedAt = updatedAt;
        else if (createdAt) out.meta.updatedAt = createdAt;
        var ids = Object.create(null);
        (Array.isArray(saved.accounts) ? saved.accounts : []).forEach(function (source) {
            var account = cleanAccount(source, ids);
            if (account) out.accounts.push(account);
        });
        var accountsById = accountMap(out.accounts);

        var snapshots = object(saved.snapshots);
        Object.keys(snapshots).forEach(function (month) {
            if (E.validMonth(month)) out.snapshots[month] = cleanBalances(snapshots[month], accountsById);
        });

        var datedSnapshots = object(saved.datedSnapshots || saved.balanceSnapshots);
        Object.keys(datedSnapshots).forEach(function (date) {
            if (E.validDate(date)) out.datedSnapshots[date] = cleanBalances(datedSnapshots[date], accountsById);
        });

        var ageIncome = object(saved.ageIncome);
        Object.keys(ageIncome).forEach(function (month) {
            if (!E.validMonth(month)) return;
            var source = object(ageIncome[month]), entry = {};
            var age = finite(source.age), income = finite(source.income);
            if (age !== null && age >= 0) entry.age = age;
            if (income !== null && income >= 0) entry.income = income;
            if (Object.keys(entry).length) out.ageIncome[month] = entry;
        });

        var usedTxnIds = Object.create(null);
        (Array.isArray(saved.txns) ? saved.txns : []).forEach(function (source) {
            var transaction = cleanTxn(source, usedTxnIds, accountsById);
            if (transaction) out.txns.push(transaction);
        });
        out.txns.sort(sortTxns);

        var cashSeen = Object.create(null);
        (Array.isArray(saved.cashMonths) ? saved.cashMonths : []).forEach(function (month) {
            if (E.validMonth(month) && !cashSeen[month]) {
                cashSeen[month] = true;
                out.cashMonths.push(month);
            }
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
        var keys = [KEY].concat(LEGACY_KEYS);
        for (var i = 0; i < keys.length; i++) {
            try {
                var raw = localStorage.getItem(keys[i]);
                if (raw) return { data: adopt(JSON.parse(raw)), migrated: keys[i] !== KEY };
            } catch (e) { /* try the next compatible key */ }
        }
        return { data: empty(), migrated: false };
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
                FireApp.toast('Tracker changes are only in memory - browser storage failed');
            }
            return false;
        }
    }

    function commit(touchMetadata) {
        state.meta = object(state.meta);
        if (!timestamp(state.meta.createdAt)) state.meta.createdAt = new Date().toISOString();
        if (touchMetadata !== false || !timestamp(state.meta.updatedAt)) state.meta.updatedAt = new Date().toISOString();
        E.setKindOverrides(state.categoryKinds);
        var persisted = save();
        listeners.slice().forEach(function (fn) {
            try { fn(state); } catch (e) { if (global.console && console.error) console.error(e); }
        });
        return persisted;
    }

    function checkpoint() {
        if (!state) return;
        undoStack.push(clone(state));
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }

    function findById(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function replaceItem(list, id, item) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) {
                list[i] = item;
                return true;
            }
        }
        return false;
    }

    function markFresh(accountId, asOf, source) {
        var account = findById(state.accounts, accountId);
        if (!account) return;
        account.freshness = object(account.freshness);
        account.freshness.source = text(source || account.freshness.source, 'manual', 80);
        account.freshness.updatedAt = new Date().toISOString();
    }

    global.TrackerStore = {
        SCHEMA_VERSION: SCHEMA_VERSION,
        UNDO_LIMIT: UNDO_LIMIT,

        init: function () {
            var loaded = load();
            state = loaded.data;
            undoStack = [];
            E.setKindOverrides(state.categoryKinds);
            if (loaded.migrated && save()) {
                LEGACY_KEYS.forEach(function (key) {
                    try { localStorage.removeItem(key); } catch (e) { /* the v3 copy is already durable */ }
                });
            }
        },

        get: function () { return state; },
        metadata: function () { return clone(state.meta); },
        persistenceError: function () { return lastSaveError; },
        hasNetWorth: function () {
            return Object.keys(state.snapshots).length > 0 || Object.keys(state.datedSnapshots).length > 0;
        },
        hasCash: function () { return state.txns.length > 0 || state.cashMonths.length > 0; },

        /* Cloud/account replacement is a new trust domain, so old undo data is discarded. */
        replace: function (obj) {
            state = adopt(obj);
            undoStack = [];
            return commit(false);
        },

        isEmpty: function () {
            return !this.hasNetWorth() && !this.hasCash() && state.accounts.length === 0 &&
                Object.keys(state.ageIncome).length === 0 && Object.keys(state.categoryKinds).length === 0 &&
                Object.keys(state.csvColumns).length === 0;
        },

        seedFrom: function (seed, scope) {
            if (!seed || typeof seed !== 'object') return false;
            if (scope === 'networth' && (!Array.isArray(seed.accounts) || !seed.snapshots)) return false;
            if (scope === 'cashflow' && !Array.isArray(seed.txns) && !Array.isArray(seed.cashMonths)) return false;
            var incoming = adopt(seed);
            checkpoint();
            if (scope === 'networth') {
                state.accounts = incoming.accounts;
                state.snapshots = incoming.snapshots;
                state.datedSnapshots = incoming.datedSnapshots;
                state.ageIncome = incoming.ageIncome;
            } else if (scope === 'cashflow') {
                state.txns = incoming.txns;
                state.cashMonths = incoming.cashMonths;
            } else {
                if (!this.hasNetWorth()) {
                    state.accounts = incoming.accounts;
                    state.snapshots = incoming.snapshots;
                    state.datedSnapshots = incoming.datedSnapshots;
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
            undoStack = [];
            state = empty();
            return commit();
        },

        resetNetWorth: function () {
            checkpoint();
            state.accounts = [];
            state.snapshots = {};
            state.datedSnapshots = {};
            state.ageIncome = {};
            state.txns.forEach(function (transaction) { transaction.accountId = ''; });
            return commit();
        },

        resetCash: function () {
            checkpoint();
            state.txns = [];
            state.cashMonths = [];
            return commit();
        },

        /* ---------- undo ---------- */
        canUndo: function () { return undoStack.length > 0; },
        undoDepth: function () { return undoStack.length; },
        clearUndo: function () { undoStack = []; },
        undo: function () {
            if (!undoStack.length) return false;
            state = adopt(undoStack.pop());
            commit();
            return true;
        },

        /* ---------- accounts ---------- */
        addAccount: function (name, group, options) {
            var source = Object.assign({}, object(options), { id: newId('a'), name: name, group: group });
            var account = cleanAccount(source, Object.create(null));
            if (!account) return;
            checkpoint();
            state.accounts.push(account);
            commit();
            return account;
        },

        updateAccount: function (id, patch) {
            var account = findById(state.accounts, id);
            if (!account || !patch) return false;
            if (patch.apr !== undefined && patch.apr !== null && patch.apr !== '') {
                var apr = finite(patch.apr);
                if (apr === null || apr < 0 || apr > 100) return false;
            }
            if (patch.minimumPayment !== undefined && patch.minimumPayment !== null && patch.minimumPayment !== '') {
                var payment = finite(patch.minimumPayment);
                if (payment === null || payment < 0) return false;
            }
            if (patch.dueDay !== undefined && patch.dueDay !== null && patch.dueDay !== '') {
                var dueDay = finite(patch.dueDay);
                if (dueDay === null || dueDay < 1 || dueDay > 31) return false;
            }
            var source = Object.assign({}, account, patch, { id: id });
            var candidate = cleanAccount(source, Object.create(null));
            if (!candidate) return false;
            checkpoint();
            replaceItem(state.accounts, id, candidate);
            commit();
            return true;
        },

        renameAccount: function (id, name) {
            var account = findById(state.accounts, id);
            var next = text(name, '', 200);
            if (!account || !next) return false;
            checkpoint();
            account.name = next;
            commit();
            return true;
        },

        setAccountFreshness: function (id, freshness) {
            var account = findById(state.accounts, id);
            if (!account || !freshness || typeof freshness !== 'object') return false;
            checkpoint();
            account.freshness = cleanFreshness(freshness);
            commit();
            return true;
        },

        removeAccount: function (id) {
            if (!findById(state.accounts, id)) return false;
            checkpoint();
            state.accounts = state.accounts.filter(function (account) { return account.id !== id; });
            Object.keys(state.snapshots).forEach(function (month) { delete state.snapshots[month][id]; });
            Object.keys(state.datedSnapshots).forEach(function (date) { delete state.datedSnapshots[date][id]; });
            state.txns.forEach(function (transaction) { if (transaction.accountId === id) transaction.accountId = ''; });
            commit();
            return true;
        },

        /* ---------- monthly and dated balance snapshots ---------- */
        addMonth: function () {
            var months = Object.keys(state.snapshots).sort();
            var month, base = {};
            if (months.length) {
                var last = months[months.length - 1];
                month = E.nextMonth(last);
                base = Object.assign({}, state.snapshots[last]);
            } else {
                month = currentMonth();
            }
            checkpoint();
            state.snapshots[month] = base;
            commit();
            return month;
        },

        removeMonth: function (month) {
            if (!E.validMonth(month)) return false;
            checkpoint();
            delete state.snapshots[month];
            commit();
            return true;
        },

        setBalance: function (month, accountId, value) {
            var amount = money(value);
            if (amount === null || !findById(state.accounts, accountId) || !E.validMonth(month) || !owns(state.snapshots, month)) return false;
            checkpoint();
            state.snapshots[month][accountId] = amount;
            markFresh(accountId, monthEnd(month), 'manual');
            commit();
            return true;
        },

        addDatedSnapshot: function (date, balances) {
            if (!E.validDate(date)) return false;
            var cleaned = cleanBalances(balances, accountMap(state.accounts));
            checkpoint();
            state.datedSnapshots[date] = cleaned;
            Object.keys(cleaned).forEach(function (id) { markFresh(id, date, 'manual'); });
            commit();
            return date;
        },

        setDatedBalance: function (date, accountId, value) {
            var amount = money(value);
            if (!E.validDate(date) || amount === null || !findById(state.accounts, accountId)) return false;
            checkpoint();
            if (!state.datedSnapshots[date]) state.datedSnapshots[date] = {};
            state.datedSnapshots[date][accountId] = amount;
            markFresh(accountId, date, 'manual');
            commit();
            return true;
        },

        removeDatedSnapshot: function (date) {
            if (!E.validDate(date)) return false;
            checkpoint();
            delete state.datedSnapshots[date];
            commit();
            return true;
        },

        setAgeIncome: function (month, income) {
            if (!E.validMonth(month)) return false;
            var value = finite(income);
            if (income !== null && income !== '' && (value === null || value < 0)) return false;
            checkpoint();
            if (income === null || income === '') {
                var entry = state.ageIncome[month];
                if (entry) {
                    delete entry.income;
                    if (Object.keys(entry).length === 0) delete state.ageIncome[month];
                }
            } else {
                state.ageIncome[month] = Object.assign({}, state.ageIncome[month], { income: value });
            }
            commit();
            return true;
        },

        /* ---------- cashbook months and transactions ---------- */
        addCashMonth: function () {
            var months = E.txnMonths(state.txns).concat(state.cashMonths).sort();
            var month = months.length ? E.nextMonth(months[months.length - 1]) : currentMonth();
            if (!month) month = currentMonth();
            checkpoint();
            if (state.cashMonths.indexOf(month) === -1) state.cashMonths.push(month);
            state.cashMonths.sort();
            commit();
            return month;
        },

        removeCashMonth: function (month) {
            if (!E.validMonth(month)) return false;
            checkpoint();
            state.cashMonths = state.cashMonths.filter(function (candidate) { return candidate !== month; });
            state.txns = state.txns.filter(function (transaction) { return E.monthKey(transaction.date) !== month; });
            commit();
            return true;
        },

        addTxn: function (source) {
            var amount = source && money(source.amount);
            if (!source || !E.validDate(source.date) || amount === null) return null;
            if (source.accountId && !findById(state.accounts, source.accountId)) return null;
            var splits = splitResult(source.splits, amount);
            if (!splits.valid) return null;
            var transaction = cleanTxn(Object.assign({}, source, { id: newId('m') }), Object.create(null), accountMap(state.accounts));
            if (!transaction) return null;
            checkpoint();
            state.txns.push(transaction);
            state.txns.sort(sortTxns);
            commit();
            return transaction;
        },

        updateTxn: function (id, patch) {
            var transaction = findById(state.txns, id);
            if (!transaction || !patch) return false;
            var merged = Object.assign({}, transaction, patch, { id: id });
            if (patch.name !== undefined && !text(patch.name, '', 300)) merged.name = transaction.name;
            var amount = money(merged.amount);
            if (!E.validDate(merged.date) || amount === null) return false;
            if (patch.accountId && !findById(state.accounts, patch.accountId)) return false;
            var splits = splitResult(merged.splits, amount);
            if (!splits.valid) return false;
            var candidate = cleanTxn(merged, Object.create(null), accountMap(state.accounts));
            if (!candidate) return false;
            checkpoint();
            replaceItem(state.txns, id, candidate);
            state.txns.sort(sortTxns);
            commit();
            return true;
        },

        updateTxns: function (ids, patch) {
            if (!Array.isArray(ids) || !patch || typeof patch !== 'object') return false;
            var wanted = Object.create(null);
            ids.forEach(function (id) {
                id = text(id, '', 160);
                if (id) wanted[id] = true;
            });
            var matches = state.txns.filter(function (transaction) { return wanted[transaction.id]; });
            if (!matches.length || matches.length !== Object.keys(wanted).length) return false;
            var accountsById = accountMap(state.accounts), candidates = [];
            for (var i = 0; i < matches.length; i++) {
                var merged = Object.assign({}, matches[i], patch, { id: matches[i].id });
                if (patch.name !== undefined && !text(patch.name, '', 300)) merged.name = matches[i].name;
                var amount = money(merged.amount);
                if (!E.validDate(merged.date) || amount === null) return false;
                if (patch.accountId && !accountsById[patch.accountId]) return false;
                var splits = splitResult(merged.splits, amount);
                if (!splits.valid) return false;
                var candidate = cleanTxn(merged, Object.create(null), accountsById);
                if (!candidate) return false;
                candidates.push(candidate);
            }
            checkpoint();
            candidates.forEach(function (candidate) { replaceItem(state.txns, candidate.id, candidate); });
            state.txns.sort(sortTxns);
            commit();
            return candidates.length;
        },

        removeTxn: function (id) {
            if (!findById(state.txns, id)) return false;
            checkpoint();
            state.txns = state.txns.filter(function (transaction) { return transaction.id !== id; });
            commit();
            return true;
        },

        removeTxns: function (ids) {
            if (!Array.isArray(ids)) return 0;
            var wanted = Object.create(null);
            ids.forEach(function (id) {
                id = text(id, '', 160);
                if (id) wanted[id] = true;
            });
            var before = state.txns.length;
            var next = state.txns.filter(function (transaction) { return !wanted[transaction.id]; });
            var removed = before - next.length;
            if (!removed) return 0;
            checkpoint();
            state.txns = next;
            commit();
            return removed;
        },

        /* ---------- category kinds, CSV columns, and import ---------- */
        setCategoryKind: function (category, kind) {
            var cat = text(category, '', 200);
            if (!cat || E.KINDS.indexOf(kind) === -1) return false;
            checkpoint();
            var folded = cat.toLowerCase();
            Object.keys(state.categoryKinds).forEach(function (existing) {
                if (existing.toLowerCase() === folded) delete state.categoryKinds[existing];
            });
            if (kind !== E.defaultKind(cat)) state.categoryKinds[cat] = kind;
            commit();
            return true;
        },

        setCsvColumn: function (field, header) {
            if (!owns(CSV_FIELDS, field)) return false;
            checkpoint();
            var value = text(header, '', 200);
            if (value) state.csvColumns[field] = value;
            else delete state.csvColumns[field];
            commit();
            return true;
        },

        importTxns: function (txns) {
            var seenIds = Object.create(null), existingCounts = Object.create(null), incomingCounts = Object.create(null);
            state.txns.forEach(function (transaction) {
                seenIds[transaction.id] = true;
                if (transaction.importKey) existingCounts[transaction.importKey] = (existingCounts[transaction.importKey] || 0) + 1;
            });
            var added = 0, duplicates = 0, incoming = Array.isArray(txns) ? txns : [];
            var accepted = [];
            incoming.forEach(function (source) {
                var key = source && text(source.importKey, '', 200);
                if (!key || !E.validDate(source.date) || money(source.amount) === null) return;
                incomingCounts[key] = (incomingCounts[key] || 0) + 1;
                if (incomingCounts[key] <= (existingCounts[key] || 0)) {
                    duplicates++;
                    return;
                }
                var copy = cleanTxn(Object.assign({}, source, { importKey: key }), seenIds, accountMap(state.accounts));
                if (copy) accepted.push(copy);
            });
            if (accepted.length) {
                checkpoint();
                accepted.forEach(function (transaction) { state.txns.push(transaction); });
                added = accepted.length;
                state.txns.sort(sortTxns);
            }
            var persisted = added ? commit() : !lastSaveError;
            return { added: added, duplicates: duplicates, rejected: incoming.length - added - duplicates, persisted: persisted };
        },

        subscribe: function (fn) {
            listeners.push(fn);
            return function () {
                var index = listeners.indexOf(fn);
                if (index >= 0) listeners.splice(index, 1);
            };
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
