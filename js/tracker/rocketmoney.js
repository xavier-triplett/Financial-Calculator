/* =========================================================================
 * RocketMoney — CSV import for Rocket Money transaction exports
 * (Settings → Export data, or the transactions screen's CSV download).
 * Expected columns (extras are ignored, order doesn't matter):
 *   Date, Original Date, Account Type, Account Name, Account Number,
 *   Institution Name, Name, Custom Name, Amount, Description, Category,
 *   Note, Ignored From, Tax Deductible
 * Pure string → objects; no DOM. Node-testable.
 * ========================================================================= */
(function (global) {
    'use strict';

    /* RFC-4180-ish CSV: quoted fields, embedded commas/quotes/newlines. */
    function parseCSV(text) {
        var rows = [], field = '', row = [], inQuotes = false;
        text = String(text || '');
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') { field += '"'; i++; }
                    else inQuotes = false;
                } else field += ch;
            } else if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                row.push(field); field = '';
            } else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                row.push(field); field = '';
                if (row.length > 1 || row[0] !== '') rows.push(row);
                row = [];
            } else field += ch;
        }
        if (field !== '' || row.length) { row.push(field); rows.push(row); }
        return rows;
    }

    function norm(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }

    var COLS = {
        date:        ['date'],
        origDate:    ['originaldate'],
        acctType:    ['accounttype'],
        account:     ['accountname'],
        accountNumber: ['accountnumber'],
        institution: ['institutionname'],
        name:        ['name'],
        customName:  ['customname'],
        amount:      ['amount'],
        description: ['description'],
        category:    ['category'],
        ignored:     ['ignoredfrom']
    };

    /* custom: { field: 'Header Name' } from the Categories tab — a custom
     * header claims its field before the built-in aliases are consulted. */
    function headerMap(headerRow, custom) {
        var map = Object.create(null);
        var customByNorm = Object.create(null), owned = Object.create(null);
        for (var field in custom || {}) {
            if (!Object.prototype.hasOwnProperty.call(COLS, field)) continue;
            var cn = norm(custom[field]);
            if (cn) { customByNorm[cn] = field; owned[field] = true; }
        }
        headerRow.forEach(function (h, i) {
            var n = norm(h);
            var f = customByNorm[n];
            if (f !== undefined && map[f] === undefined) { map[f] = i; return; }
            for (var key in COLS) {
                // A field with a custom header ignores its built-in aliases
                if (owned[key]) continue;
                if (COLS[key].indexOf(n) !== -1 && map[key] === undefined) map[key] = i;
            }
        });
        return map;
    }

    function validISO(s) {
        var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return false;
        var y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
        return mo >= 1 && mo <= 12 && day >= 1 && day <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
    }

    function isoParts(y, mo, day) {
        var out = String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        return validISO(out) ? out : null;
    }

    function toISO(dateStr) {
        var s = String(dateStr || '').trim();
        var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
        if (iso) return isoParts(iso[1], iso[2], iso[3]);
        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY
        if (m) return isoParts(m[3], m[1], m[2]);
        var d = new Date(s);
        if (!isNaN(d)) return isoParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
        return null;
    }

    function amountValue(raw) {
        var s = String(raw === undefined || raw === null ? '' : raw).trim();
        var paren = /^\(.*\)$/.test(s);
        if (paren) s = s.slice(1, -1).trim();
        s = s.replace(/[$,\s]/g, '');
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return null;
        var n = Number(s);
        if (!Number.isFinite(n)) return null;
        return paren ? -Math.abs(n) : n;
    }

    /* Stable id from the fields that identify a transaction, so re-importing
     * an overlapping export is a no-op. */
    function importKey(t) {
        var s = [t.date, t.origDate, t.name, t.amount.toFixed(2), t.category, t.account,
            t.accountNumber, t.institution, t.description].join('|');
        var a = 5381, b = 2166136261;
        for (var i = 0; i < s.length; i++) {
            a = ((a << 5) + a + s.charCodeAt(i)) >>> 0;
            b ^= s.charCodeAt(i);
            b = Math.imul(b, 16777619) >>> 0;
        }
        return 'rm' + a.toString(36) + b.toString(36) + s.length.toString(36);
    }

    /* parse(text, opts) → { txns, skipped, flipped }
     * opts.columns remaps importer fields to custom CSV headers.
     * Normalizes signs so expenses are positive and income positive
     * (Rocket Money exports vary: some ship debits negative). */
    function parse(text, opts) {
        var rows = parseCSV(text);
        if (!rows.length) return { txns: [], skipped: 0, flipped: false, error: 'Empty file' };

        var map = headerMap(rows[0], opts && opts.columns);
        if (map.amount === undefined || (map.date === undefined && map.origDate === undefined)) {
            return { txns: [], skipped: 0, flipped: false, error: 'Not a Rocket Money export — needs Date and Amount columns' };
        }

        var kindOf = global.TrackerEngine.categoryKind;
        var txns = [], skipped = 0, ignoredCount = 0, issues = [];
        var customNameMapped = !!(opts && opts.columns && String(opts.columns.name || '').trim());

        for (var i = 1; i < rows.length; i++) {
            var r = rows[i];
            var rawDate = r[map.date] !== undefined && String(r[map.date]).trim() !== '' ? r[map.date] : r[map.origDate];
            var date = toISO(rawDate);
            var amount = amountValue(r[map.amount]);
            if (!date || amount === null) {
                skipped++;
                issues.push({ row: i + 1, reason: !date ? 'invalid date' : 'invalid amount' });
                continue;
            }
            var ignored = map.ignored !== undefined ? String(r[map.ignored] || '').trim().toLowerCase() : '';
            if (ignored && ['none', 'false', 'no', '0'].indexOf(ignored) === -1) { skipped++; ignoredCount++; continue; }

            var rawName = map.name !== undefined ? r[map.name] : '';
            var customName = map.customName !== undefined ? r[map.customName] : '';
            var chosenName = customNameMapped ? rawName : (customName || rawName);

            txns.push({
                date: date,
                origDate: toISO(r[map.origDate]) || date,
                name: String(chosenName || r[map.description] || '').trim() || 'Unknown',
                amount: amount,
                category: String(r[map.category] || '').trim() || 'Uncategorized',
                account: String(r[map.account] || '').trim(),
                accountNumber: String(r[map.accountNumber] || '').trim(),
                institution: String(r[map.institution] || '').trim(),
                description: String(r[map.description] || '').trim()
            });
        }

        var incomePositive = 0, incomeNegative = 0, expensePositive = 0, expenseNegative = 0;
        txns.forEach(function (t) {
            var kind = kindOf(t.category);
            if (!t.amount || kind === 'transfer') return;
            if (kind === 'income') {
                if (t.amount > 0) incomePositive++;
                else incomeNegative++;
            } else {
                if (t.amount > 0) expensePositive++;
                else expenseNegative++;
            }
        });
        var forced = opts && opts.sign;
        var debitNegative = incomePositive > 0 && incomeNegative === 0 &&
            expenseNegative > 0 && expensePositive === 0;
        var expensePositiveConvention = incomeNegative > 0 && incomePositive === 0 &&
            expensePositive > 0 && expenseNegative === 0;
        var ambiguous = !forced && !debitNegative && !expensePositiveConvention;
        var flipped = forced === 'debit-negative' || (!forced && debitNegative);
        txns.forEach(function (t) {
            if (flipped) t.amount = -t.amount;
            if (kindOf(t.category) === 'income') t.amount = Math.abs(t.amount);
            t.amount = Math.round(t.amount * 100) / 100;
        });

        var occurrences = {};
        txns.forEach(function (t) {
            t.importKey = importKey(t);
            occurrences[t.importKey] = (occurrences[t.importKey] || 0) + 1;
            t.id = t.importKey + 'o' + occurrences[t.importKey].toString(36);
        });

        return {
            txns: txns,
            skipped: skipped,
            ignored: ignoredCount,
            issues: issues,
            flipped: flipped,
            signAmbiguous: ambiguous,
            signConvention: ambiguous ? 'as written' : (flipped ? 'debit-negative' : 'expense-positive')
        };
    }

    /* Example export in the expected shape — downloadable from the Cashbook
     * so imports can be hand-authored without a Rocket Money account. */
    function template() {
        return [
            'Date,Original Date,Account Type,Account Name,Account Number,Institution Name,Name,Custom Name,Amount,Description,Category,Note,Ignored From,Tax Deductible',
            '2026-01-02,2026-01-02,Cash,Checking,1234,Example Bank,Paycheck,,4600.00,EMPLOYER DIRECT DEP,Paychecks,,,',
            '2026-01-03,2026-01-03,Cash,Checking,1234,Example Bank,Mr. Cooper,,2200.00,MORTGAGE PAYMENT,Mortgage,,,',
            '2026-01-05,2026-01-05,Credit Card,Rewards Visa,5678,Example Bank,Fred Meyer,,84.52,GROCERY STORE,Groceries,,,',
            '2026-01-08,2026-01-08,Credit Card,Rewards Visa,5678,Example Bank,"Corner Cafe, The",,18.40,CORNER CAFE,Dining & Drinks,,,',
            '2026-01-09,2026-01-09,Credit Card,Rewards Visa,5678,Example Bank,Fred Meyer,,-12.00,GROCERY REFUND,Groceries,,,',
            '2026-01-10,2026-01-10,Credit Card,Rewards Visa,5678,Example Bank,Payment Thank You,,950.00,CARD PAYMENT,Credit Card Payment,,,'
        ].join('\n') + '\n';
    }

    global.RocketMoney = {
        parse: parse,
        parseCSV: parseCSV,
        template: template,
        COLS: COLS,
        toISO: toISO,
        amountValue: amountValue
    };

})(typeof window !== 'undefined' ? window : globalThis);
