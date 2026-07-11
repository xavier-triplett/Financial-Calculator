/* Shared formatting + DOM helpers. */
(function (global) {
    'use strict';

    function money(n) {
        if (n < 0) return '-' + money(Math.abs(n));
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
    }

    // $3.2M / $840k style, for KPIs and chart axes
    function compact(n) {
        var neg = n < 0 ? '-' : '';
        n = Math.abs(n);
        if (n >= 1e6) return neg + '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
        if (n >= 1e3) return neg + '$' + Math.round(n / 1e3) + 'k';
        return neg + '$' + Math.round(n);
    }

    function pctFmt(n, digits) {
        return (Number(n) || 0).toFixed(digits === undefined ? 0 : digits) + '%';
    }

    /* Whole-years age from a date of birth ('YYYY-MM-DD' or 'YYYY-MM').
     * Returns null for a missing/unparseable value. */
    function ageFromDOB(dob) {
        if (!dob) return null;
        var b = new Date(String(dob).length === 7 ? dob + '-01T00:00:00' : dob + 'T00:00:00');
        if (isNaN(b.getTime())) return null;
        var now = new Date();
        var age = now.getFullYear() - b.getFullYear();
        if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
        return age < 0 ? null : age;
    }

    // 'YYYY-MM-DD' -> 'YYYY-MM' for the tracker's month-keyed benchmarks.
    function dobToMonth(dob) {
        return dob ? String(dob).slice(0, 7) : null;
    }

    /* ---------------------------------------------------------------------
     * Currency inputs. `<input type=number>` can't hold "$1,234.50", so money
     * fields are text inputs: parsed to a Number on read, grouped US currency
     * on display, and shown as a bare number while focused for easy editing.
     * ------------------------------------------------------------------- */
    function parseNum(v) {
        if (v === null || v === undefined) return null;
        var s = String(v).replace(/[^0-9.\-]/g, '');
        if (s === '' || s === '-' || s === '.' || s === '-.') return null;
        var n = Number(s);
        return isNaN(n) ? null : n;
    }

    function groupNum(n, cents) {
        return Number(n).toLocaleString('en-US', cents
            ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
            : { maximumFractionDigits: 0 });
    }

    // e.g. moneyStr(-5000, true) -> "-$5,000"; moneyStr(18.5, true, true) -> "$18.50"
    function moneyStr(n, prefix, cents) {
        if (n === null || n === undefined || n === '') return '';
        n = Number(n);
        return (n < 0 ? '-' : '') + (prefix ? '$' : '') + groupNum(Math.abs(n), cents);
    }

    // Write a known number into a bound currency input, honoring its flags.
    function setMoneyEl(input, n) {
        input.value = moneyStr(n, input.dataset.moneyPrefix === '1', input.dataset.moneyCents === '1');
    }

    /* Turn an input into a US-currency field. Wiring for committing the value
     * stays with the caller (via change/input listeners); this only governs
     * type, formatting, and focus/blur display. opts.prefix adds "$";
     * opts.cents keeps two decimal places. */
    function bindCurrency(input, opts) {
        opts = opts || {};
        var prefix = !!opts.prefix, cents = !!opts.cents;
        input.type = 'text';
        input.setAttribute('inputmode', cents ? 'decimal' : 'numeric');
        input.dataset.money = '1';
        input.dataset.moneyPrefix = prefix ? '1' : '0';
        input.dataset.moneyCents = cents ? '1' : '0';
        input.addEventListener('focus', function () {
            var n = parseNum(input.value);
            input.value = n === null ? '' : String(n);
            try { input.select(); } catch (e) { /* not selectable */ }
        });
        input.addEventListener('blur', function () {
            setMoneyEl(input, parseNum(input.value));
        });
        if (document.activeElement !== input) setMoneyEl(input, parseNum(input.value));
        return input;
    }

    /* Flatpickr, but with the year shown as a <select> (matching the month
     * dropdown) instead of a number spinner. opts.yearRange: [minYear, maxYear]. */
    function datePicker(input, opts) {
        opts = opts || {};
        var now = new Date().getFullYear();
        var range = opts.yearRange || [now - 100, now];
        var config = {}, k;
        for (k in opts) if (k !== 'yearRange') config[k] = opts[k];

        var sel = null;
        function sync(dates, str, fp) { if (sel) sel.value = fp.currentYear; }
        config.onReady = function (dates, str, fp) {
            var wrap = fp.currentYearElement.parentNode;
            sel = el('select', { class: 'flatpickr-yearDropdown-years' });
            for (var y = range[1]; y >= range[0]; y--) sel.appendChild(el('option', { value: y, text: y }));
            sel.addEventListener('change', function () { fp.changeYear(parseInt(sel.value, 10)); });
            wrap.parentNode.insertBefore(sel, wrap);
            wrap.style.display = 'none';
            sync(dates, str, fp);
        };
        config.onYearChange = sync;
        config.onOpen = sync;

        return flatpickr(input, config);
    }

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            for (var k in attrs) {
                if (k === 'class') node.className = attrs[k];
                else if (k === 'text') node.textContent = attrs[k];
                else if (k === 'html') node.innerHTML = attrs[k];
                else node.setAttribute(k, attrs[k]);
            }
        }
        if (children) {
            children.forEach(function (c) { if (c) node.appendChild(c); });
        }
        return node;
    }

    function debounce(fn, ms) {
        var t = null;
        return function () {
            var args = arguments, self = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, args); }, ms);
        };
    }

    global.FireUtil = {
        money: money, compact: compact, pct: pctFmt, el: el, debounce: debounce,
        parseNum: parseNum, moneyStr: moneyStr, setMoneyEl: setMoneyEl, bindCurrency: bindCurrency,
        ageFromDOB: ageFromDOB, dobToMonth: dobToMonth, datePicker: datePicker
    };

})(typeof window !== 'undefined' ? window : globalThis);
