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

    function norm(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z]/g, ''); }

    var COLS = {
        date:        ['date'],
        origDate:    ['originaldate'],
        acctType:    ['accounttype'],
        account:     ['accountname'],
        institution: ['institutionname'],
        name:        ['name', 'customname'],
        amount:      ['amount'],
        description: ['description'],
        category:    ['category'],
        ignored:     ['ignoredfrom']
    };

    function headerMap(headerRow) {
        var map = {};
        headerRow.forEach(function (h, i) {
            var n = norm(h);
            for (var key in COLS) {
                if (COLS[key].indexOf(n) !== -1 && map[key] === undefined) map[key] = i;
            }
        });
        return map;
    }

    function toISO(dateStr) {
        var s = String(dateStr || '').trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // M/D/YYYY
        if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
        var d = new Date(s);
        if (!isNaN(d)) return d.toISOString().slice(0, 10);
        return null;
    }

    /* Stable id from the fields that identify a transaction, so re-importing
     * an overlapping export is a no-op. */
    function txnId(t) {
        var s = t.date + '|' + t.name + '|' + t.amount.toFixed(2) + '|' + (t.account || '');
        var h = 5381;
        for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
        return 'rm' + h.toString(36) + s.length.toString(36);
    }

    /* parse(text) → { txns, skipped, flipped }
     * Normalizes signs so expenses are positive and income positive
     * (Rocket Money exports vary: some ship debits negative). */
    function parse(text) {
        var rows = parseCSV(text);
        if (!rows.length) return { txns: [], skipped: 0, flipped: false, error: 'Empty file' };

        var map = headerMap(rows[0]);
        if (map.amount === undefined || (map.date === undefined && map.origDate === undefined)) {
            return { txns: [], skipped: 0, flipped: false, error: 'Not a Rocket Money export — needs Date and Amount columns' };
        }

        var kindOf = global.TrackerEngine.categoryKind;
        var txns = [], skipped = 0;

        for (var i = 1; i < rows.length; i++) {
            var r = rows[i];
            var date = toISO(r[map.date] !== undefined && r[map.date] !== '' ? r[map.date] : r[map.origDate]);
            var amount = parseFloat(String(r[map.amount] || '').replace(/[$,]/g, ''));
            if (!date || isNaN(amount)) { skipped++; continue; }
            var ignored = map.ignored !== undefined ? String(r[map.ignored] || '').trim().toLowerCase() : '';
            if (ignored && ignored !== 'none') { skipped++; continue; }

            txns.push({
                date: date,
                name: String((map.name !== undefined && r[map.name]) || r[map.description] || '').trim() || 'Unknown',
                amount: amount,
                category: String(r[map.category] || '').trim() || 'Uncategorized',
                account: String(r[map.account] || '').trim(),
                institution: String(r[map.institution] || '').trim(),
                description: String(r[map.description] || '').trim()
            });
        }

        // Sign heuristic: if the expense-side rows sum negative, the export
        // uses debit-negative convention — flip so expenses are positive.
        var expenseSum = 0;
        txns.forEach(function (t) {
            var k = kindOf(t.category);
            if (k !== 'income' && k !== 'transfer') expenseSum += t.amount;
        });
        var flipped = expenseSum < 0;
        txns.forEach(function (t) {
            if (flipped) t.amount = -t.amount;
            if (kindOf(t.category) === 'income') t.amount = Math.abs(t.amount);
            t.amount = Math.round(t.amount * 100) / 100;
            t.id = txnId(t);
        });

        return { txns: txns, skipped: skipped, flipped: flipped };
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

    global.RocketMoney = { parse: parse, parseCSV: parseCSV, template: template };

})(typeof window !== 'undefined' ? window : globalThis);
