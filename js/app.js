/* FireApp — boot, computation cache, view switching, toast. */
(function (global) {
    'use strict';

    var PREF_KEY = 'uiPref_v3';

    var results = { sim: null, mc: null };
    var toastEl, toastTimer;
    var startYear = new Date().getFullYear();

    var root, navEl, confirmLayer, confirmMessage, confirmAccept, confirmInput;
    var pendingConfirm = null, confirmReturnFocus = null;
    var active = null; // { ui, kind } currently mounted
    var pref = { view: 'profile', theme: null };

    function compute() {
        var state = FireStore.get();
        results.sim = FireEngine.simulate(state.inputs, state.phases, { startYear: startYear });
        results.mc = FireEngine.monteCarlo(state.inputs, state.phases, { seed: state.mcSeed, startYear: startYear });
        return results;
    }

    /* Plan verdicts, stated once so every part of the UI agrees on the facts. */
    function verdicts() {
        var s = results.sim.summary;
        var inputs = FireStore.get().inputs;
        var bridge;
        if (inputs.retireAge >= inputs.standardRetireAge) {
            bridge = { code: 'na', label: 'N/A' };
        } else if (s.bridgeFailureAge !== null) {
            bridge = { code: 'failed', label: 'Empty at ' + s.bridgeFailureAge, age: s.bridgeFailureAge };
        } else {
            bridge = { code: 'secure', label: 'Secure' };
        }

        var coast;
        if (s.ranOutOfMoneyAge !== null) {
            coast = { code: 'broke', label: 'Broke at ' + s.ranOutOfMoneyAge, age: s.ranOutOfMoneyAge };
        } else if (s.standardSuccess) {
            coast = { code: 'secure', label: 'Secure', coverage: s.standardCoverage };
        } else {
            coast = { code: 'partial', label: s.standardCoverage.toFixed(0) + '% funded', coverage: s.standardCoverage };
        }

        return { bridge: bridge, coast: coast, successRate: results.mc.successRate };
    }

    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
    }

    function closeConfirm(accepted) {
        if (!pendingConfirm) return;
        var action = pendingConfirm;
        pendingConfirm = null;
        confirmLayer.classList.remove('show');
        confirmLayer.setAttribute('aria-hidden', 'true');
        if (confirmReturnFocus && document.contains(confirmReturnFocus)) confirmReturnFocus.focus();
        if (accepted) action(confirmInput.value);
    }

    /* opts.input shows a text field; the accepted callback receives its
     * value. Without it this is the plain destructive confirm. */
    function askConfirm(message, onConfirm, actionLabel, opts) {
        opts = opts || {};
        pendingConfirm = onConfirm;
        confirmReturnFocus = document.activeElement;
        confirmMessage.textContent = message;
        confirmAccept.textContent = actionLabel || 'Delete';
        confirmAccept.classList.toggle('confirm-danger', !opts.input);
        confirmLayer.classList.toggle('with-input', !!opts.input);
        confirmInput.value = '';
        confirmInput.placeholder = opts.placeholder || '';
        confirmLayer.classList.add('show');
        confirmLayer.setAttribute('aria-hidden', 'false');
        (opts.input ? confirmInput : confirmAccept).focus();
    }

    function askPrompt(message, onSubmit, actionLabel, placeholder) {
        askConfirm(message, onSubmit, actionLabel || 'Save', { input: true, placeholder: placeholder });
    }

    /* ---------------- view switching ---------------- */
    function loadPref() {
        try {
            var saved = JSON.parse(localStorage.getItem(PREF_KEY));
            if (saved && saved.view) pref = saved;
        } catch (e) { /* defaults */ }
        if (pref.theme !== 'dark' && pref.theme !== 'light') {
            pref.theme = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        applyTheme();
    }

    function applyTheme() {
        document.documentElement.setAttribute('data-theme', pref.theme);
        if (global.TrackerKit) {
            global.TrackerKit.PALETTE.ink = pref.theme === 'dark' ? '#E8ECE8' : '#1A211D';
            global.TrackerKit.PALETTE.taxFree = pref.theme === 'dark' ? '#8BE8BC' : '#17604A';
            global.TrackerKit.PALETTE.income = pref.theme === 'dark' ? '#8BE8BC' : '#17604A';
        }
    }

    function toggleTheme() {
        pref.theme = pref.theme === 'dark' ? 'light' : 'dark';
        applyTheme();
        savePref();
        mountActive();
    }

    function savePref() {
        try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (e) { /* blocked */ }
    }

    /* Every tab, in nav order: FireUIs (Profile, Planner — read FireStore)
     * then TrackerUIs (Net Worth, Cashbook — read TrackerStore). */
    function allTabs() {
        var fire = (global.FireUIs || []).map(function (u) { return { ui: u, kind: 'fire' }; });
        var trk = (global.TrackerUIs || []).map(function (u) { return { ui: u, kind: 'tracker' }; });
        return fire.concat(trk);
    }

    function currentEntry() {
        var tabs = allTabs();
        for (var i = 0; i < tabs.length; i++) if (tabs[i].ui.id === pref.view) return tabs[i];
        return tabs[0];
    }

    function refreshActive() {
        if (!active) return;
        if (active.kind === 'fire') active.ui.update(FireStore.get(), results);
        else active.ui.update(TrackerStore.get());
    }

    function mountActive() {
        if (active && active.ui.unmount) active.ui.unmount();
        active = currentEntry();
        root.className = 'ui-' + active.ui.id;
        root.innerHTML = '';
        active.ui.mount(root);
        refreshActive();
        renderNav();
    }

    function setView(view) {
        if (pref.view === view) return;
        pref.view = view;
        savePref();
        mountActive();
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    /* Google sign-in control, only when the cloud layer is configured. */
    function authHtml() {
        if (!global.FireCloud || !FireCloud.available()) return '';
        var user = FireCloud.user();
        if (user) {
            var who = user.displayName || user.email || 'Account';
            return '<span class="nav-user" title="' + escapeHtml(user.email || who) + '">' + escapeHtml(who) + '</span>' +
                '<button class="nav-auth" type="button" data-auth-signout>Sign out</button>';
        }
        return '<button class="nav-auth nav-auth-in" type="button" data-auth-signin title="Save your data to your account">Sign in with Google</button>';
    }

    var navMenuOpen = false;

    function tabButtonsHtml() {
        return allTabs().map(function (t) {
            return '<button class="nav-tab' + (t.ui.id === (active ? active.ui.id : pref.view) ? ' active' : '') +
                '" data-view="' + t.ui.id + '"' + (t.ui.tag ? ' title="' + t.ui.tag + '"' : '') + '>' + t.ui.name + '</button>';
        }).join('');
    }

    function renderNav() {
        var burger = navMenuOpen
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
        navEl.innerHTML = '<span class="nav-brand">The Coast Ledger</span>' +
            '<span class="nav-tabs">' + tabButtonsHtml() + '</span>' +
            '<span class="nav-right">' + authHtml() +
                '<button class="nav-theme" type="button" data-theme-toggle aria-label="Switch to ' +
                    (pref.theme === 'dark' ? 'light' : 'dark') + ' mode" title="Switch to ' +
                    (pref.theme === 'dark' ? 'light' : 'dark') + ' mode">' +
                    (pref.theme === 'dark' ? '&#9728;' : '&#9790;') + '</button>' +
                '<button class="nav-burger" type="button" data-nav-burger aria-label="Menu" aria-expanded="' + navMenuOpen + '">' + burger + '</button>' +
            '</span>' +
            '<div class="nav-menu"' + (navMenuOpen ? '' : ' hidden') + '>' + tabButtonsHtml() + '</div>';
        updateNavCollapse();
    }

    /* Collapse the tab row into the hamburger whenever it can't fit without
     * scrolling. Measured, not a breakpoint: the row overflows the nav on
     * mid widths (single-row layout) or scrolls inside itself on phones
     * (full-width row) — either way the tabs aren't all reachable at once. */
    function updateNavCollapse() {
        navEl.classList.remove('nav-collapsed');
        var tabs = navEl.querySelector('.nav-tabs');
        var overflowing = navEl.scrollWidth > navEl.clientWidth + 1 ||
            (tabs && tabs.scrollWidth > tabs.clientWidth + 1);
        if (overflowing) {
            navEl.classList.add('nav-collapsed');
        } else if (navMenuOpen) {
            navMenuOpen = false;
            var menu = navEl.querySelector('.nav-menu');
            if (menu) menu.hidden = true;
        }
    }

    function boot() {
        root = document.getElementById('ui-root');
        toastEl = document.getElementById('toast');
        navEl = document.getElementById('app-nav');
        confirmLayer = document.getElementById('confirm-layer');
        confirmMessage = document.getElementById('confirm-message');
        confirmAccept = confirmLayer.querySelector('[data-confirm-accept]');
        confirmInput = document.getElementById('confirm-input');
        confirmInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') closeConfirm(true);
        });

        loadPref();
        FireStore.init();
        TrackerStore.init();
        compute();

        navEl.addEventListener('click', function (e) {
            if (e.target.dataset.view) {
                navMenuOpen = false;
                // setView no-ops on the current tab; still close the menu
                if (pref.view === e.target.dataset.view) renderNav();
                else setView(e.target.dataset.view);
            }
            if (e.target.closest('[data-nav-burger]')) { navMenuOpen = !navMenuOpen; renderNav(); }
            if (e.target.closest('[data-theme-toggle]')) toggleTheme();
            if (e.target.closest('[data-auth-signin]')) FireCloud.signIn();
            if (e.target.closest('[data-auth-signout]')) FireCloud.signOut();
        });
        window.addEventListener('resize', updateNavCollapse);
        document.addEventListener('click', function (e) {
            // composedPath, not closest: the nav re-renders on burger clicks,
            // so by the time this runs the click target may be detached.
            if (navMenuOpen && e.composedPath().indexOf(navEl) === -1) { navMenuOpen = false; renderNav(); }
        });
        confirmLayer.addEventListener('click', function (e) {
            if (e.target.closest('[data-confirm-accept]')) closeConfirm(true);
            else if (e.target.closest('[data-confirm-cancel]') || e.target === confirmLayer) closeConfirm(false);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && pendingConfirm) closeConfirm(false);
            else if (e.key === 'Escape' && navMenuOpen) { navMenuOpen = false; renderNav(); }
        });

        /* Info hints: tap toggles the tooltip. Explicit focus()/blur()
         * because Safari never focuses a tapped span, and hints inside a
         * <label> would otherwise hand the tap to the labelled input. */
        var hintWasOpen = false;
        document.addEventListener('pointerdown', function (e) {
            var hint = e.target.closest('.ff-hint[data-tooltip]');
            hintWasOpen = !!hint && document.activeElement === hint;
        });
        document.addEventListener('click', function (e) {
            var hint = e.target.closest('.ff-hint[data-tooltip]');
            if (!hint) {
                var a = document.activeElement;
                if (a && a.classList && a.classList.contains('ff-hint')) a.blur();
                return;
            }
            e.preventDefault();
            if (hintWasOpen) hint.blur();
            else hint.focus();
        });

        mountActive();

        FireStore.subscribe(function () {
            compute();
            refreshActive(); // tracker skins also re-render: the plan bridge and FI overlays read the plan
        });
        TrackerStore.subscribe(function () {
            refreshActive();
        });

        // Optional cloud sync (Google sign-in). No-op when unconfigured/offline.
        if (global.FireCloud && FireCloud.available()) {
            FireCloud.onChange(function () { renderNav(); });
            FireCloud.init();
        }
    }

    global.FireUIs = global.FireUIs || [];
    global.TrackerUIs = global.TrackerUIs || [];
    global.FireApp = {
        boot: boot,
        toast: toast,
        confirm: askConfirm,
        prompt: askPrompt,
        verdicts: verdicts,
        results: function () { return results; },
        startYear: function () { return startYear; },
        confirmReset: function () {
            askConfirm('Reset all plan data to defaults?', function () {
                FireStore.reset();
                toast('Plan reset to defaults');
            }, 'Reset');
        }
    };

    document.addEventListener('DOMContentLoaded', boot);

})(typeof window !== 'undefined' ? window : globalThis);
