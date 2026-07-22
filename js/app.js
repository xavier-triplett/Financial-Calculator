/* FireApp — boot, computation cache, view switching, toast. */
(function (global) {
    'use strict';

    var PREF_KEY = 'uiPref_v3';

    var results = { sim: null, mc: null };
    var toastEl, toastTimer;
    var startYear = new Date().getFullYear();

    var root, navEl, confirmLayer, confirmPrompt, confirmMessage, confirmAccept, confirmAlternate, confirmCancel, confirmInput;
    var pendingConfirm = null, pendingAlternate = null, pendingCancel = null, confirmReturnFocus = null;
    var confirmStrict = false;  // strict dialogs ignore backdrop/Escape
    var confirmQueue = [];      // requests arriving while a dialog is open
    var active = null; // { ui, kind } currently mounted
    var pref = { view: 'profile', theme: null, mode: null };

    function setBackgroundInert(inert) {
        Array.prototype.forEach.call(document.body.children, function (node) {
            if (node !== confirmLayer && node.tagName !== 'SCRIPT') node.inert = inert;
        });
    }

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

    function closeConfirm(accepted, alternate) {
        if (!pendingConfirm) return;
        var action = pendingConfirm, onAlternate = pendingAlternate, onCancel = pendingCancel;
        pendingConfirm = null;
        pendingAlternate = null;
        pendingCancel = null;
        confirmStrict = false;
        confirmLayer.classList.remove('show');
        confirmLayer.setAttribute('aria-hidden', 'true');
        confirmLayer.hidden = true;
        setBackgroundInert(false);
        if (confirmReturnFocus && document.contains(confirmReturnFocus)) confirmReturnFocus.focus();
        if (alternate && onAlternate) onAlternate();
        else if (accepted) action(confirmInput.value);
        else if (onCancel) onCancel();
        if (confirmQueue.length) {
            var next = confirmQueue.shift();
            askConfirm(next[0], next[1], next[2], next[3]);
        }
    }

    /* opts.input shows a text field; the accepted callback receives its
     * value. Without it this is the plain destructive confirm.
     * opts.onCancel runs when the dialog is dismissed instead.
     * opts.alternateLabel and opts.onAlternate add a third explicit choice.
     * opts.strict requires an explicit button: backdrop/Escape do nothing.
     * A request arriving while a dialog is open waits its turn. */
    function askConfirm(message, onConfirm, actionLabel, opts) {
        if (pendingConfirm) {
            confirmQueue.push([message, onConfirm, actionLabel, opts]);
            return;
        }
        opts = opts || {};
        pendingConfirm = onConfirm;
        pendingAlternate = opts.onAlternate || null;
        pendingCancel = opts.onCancel || null;
        confirmStrict = !!opts.strict;
        confirmReturnFocus = document.activeElement;
        confirmMessage.textContent = message;
        confirmAccept.textContent = actionLabel || 'Delete';
        confirmAlternate.textContent = opts.alternateLabel || '';
        confirmAlternate.hidden = !opts.alternateLabel;
        confirmCancel.textContent = opts.cancelLabel || 'Cancel';
        confirmAccept.classList.toggle('confirm-danger', !opts.input);
        confirmLayer.classList.toggle('with-input', !!opts.input);
        confirmInput.value = '';
        confirmInput.placeholder = opts.placeholder || '';
        confirmLayer.hidden = false;
        setBackgroundInert(true);
        confirmLayer.classList.add('show');
        confirmLayer.setAttribute('aria-hidden', 'false');
        (opts.input ? confirmInput : confirmCancel).focus();
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
        if (global.TrackerKit) global.TrackerKit.setTheme(pref.theme);
    }

    function applyMode() {
        document.documentElement.setAttribute('data-mode', pref.mode);
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
        return fire.concat(trk).filter(function (t) { return pref.mode === 'expert' || !t.ui.expertOnly; });
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
        if (global.FireForms) FireForms.cancelPending();
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

    function setMode(mode) {
        if ((mode !== 'beginner' && mode !== 'expert') || pref.mode === mode) return;
        pref.mode = mode;
        applyMode();
        pref.view = currentEntry().ui.id;
        savePref();
        mountActive();
        toast(mode === 'beginner' ? 'Beginner view on' : 'Expert view on');
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
                cloudStatusHtml(FireCloud.status ? FireCloud.status() : null) +
                '<button class="nav-auth" type="button" data-auth-signout>Sign out</button>';
        }
        return '<button class="nav-auth nav-auth-in" type="button" data-auth-signin title="Save your data to your account">Sign in with Google</button>';
    }

    function cloudStatusHtml(status) {
        if (!status) return '';
        var phase = status.phase;
        if (phase === 'conflict') {
            return '<span class="nav-sync nav-sync-error" role="status">Sync conflict</span>' +
                '<button class="nav-auth" type="button" data-cloud-resolve>Resolve</button>';
        }
        if (phase === 'error') {
            return '<span class="nav-sync nav-sync-error" role="status" title="' + escapeHtml(status.error || 'Cloud sync failed') + '">Sync error</span>' +
                '<button class="nav-auth" type="button" data-cloud-retry>Retry</button>';
        }
        var labels = {
            'loading-sdk': 'Connecting', hydrating: 'Loading cloud', dirty: 'Changes pending',
            syncing: 'Syncing', synced: 'Synced', retrying: 'Retrying'
        };
        var label = labels[phase];
        if (!label) return '';
        var cls = phase === 'synced' ? ' nav-sync-ok' : phase === 'retrying' ? ' nav-sync-warn' : '';
        return '<span class="nav-sync' + cls + '" role="status">' + label + '</span>';
    }

    function applyCloudResolution(strategy, expectedUid) {
        var user = FireCloud.user();
        if (!user || user.uid !== expectedUid) {
            toast('Account changed; open the current sync conflict again');
            return;
        }
        var useRemote = strategy === 'remote';
        FireCloud.resolveConflict(strategy).then(function (ok) {
            toast(ok ? (useRemote ? 'Cloud data loaded' : 'This device was saved to the cloud') : 'Sync conflict was not resolved');
        });
    }

    function resolveCloudConflict() {
        var user = FireCloud.user();
        if (!user) return;
        var expectedUid = user.uid;
        askConfirm(
            'Cloud data changed on another device. Use cloud replaces this device; Overwrite cloud replaces the cloud copy.',
            function () { applyCloudResolution('remote', expectedUid); },
            'Use cloud',
            {
                strict: true,
                alternateLabel: 'Overwrite cloud',
                onAlternate: function () { applyCloudResolution('local', expectedUid); }
            }
        );
    }

    var navMenuOpen = false;

    function tabButtonsHtml() {
        return allTabs().map(function (t) {
            return '<button class="nav-tab' + (t.ui.id === (active ? active.ui.id : pref.view) ? ' active' : '') +
                '" data-view="' + t.ui.id + '"' +
                (t.ui.id === (active ? active.ui.id : pref.view) ? ' aria-current="page"' : '') +
                (t.ui.tag ? ' title="' + t.ui.tag + '"' : '') + '>' + t.ui.name + '</button>';
        }).join('');
    }

    function navFocusSelector(node) {
        if (!node || !navEl.contains(node)) return null;
        if (node.dataset.view) return '[data-view="' + node.dataset.view + '"]';
        if (node.dataset.modeSet) return '[data-mode-set="' + node.dataset.modeSet + '"]';
        if (node.closest('[data-auth-signin]')) return '[data-auth-signin]';
        if (node.closest('[data-auth-signout]')) return '[data-auth-signout]';
        if (node.closest('[data-cloud-resolve]')) return '[data-cloud-resolve]';
        if (node.closest('[data-cloud-retry]')) return '[data-cloud-retry]';
        if (node.closest('[data-theme-toggle]')) return '[data-theme-toggle]';
        if (node.closest('[data-nav-burger]')) return '[data-nav-burger]';
        return null;
    }

    function renderNav() {
        var focusSelector = navFocusSelector(document.activeElement);
        var burger = navMenuOpen
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
        navEl.innerHTML = '<span class="nav-brand">The Coast Ledger</span>' +
            '<span class="nav-tabs">' + tabButtonsHtml() + '</span>' +
            '<span class="nav-right">' + authHtml() +
                '<span class="nav-mode" role="group" aria-label="Detail level">' +
                    '<button type="button" data-mode-set="beginner" class="' + (pref.mode === 'beginner' ? 'active' : '') + '" aria-pressed="' + (pref.mode === 'beginner') + '">Beginner</button>' +
                    '<button type="button" data-mode-set="expert" class="' + (pref.mode === 'expert' ? 'active' : '') + '" aria-pressed="' + (pref.mode === 'expert') + '">Expert</button>' +
                '</span>' +
                '<button class="nav-theme" type="button" data-theme-toggle aria-label="Switch to ' +
                    (pref.theme === 'dark' ? 'light' : 'dark') + ' mode" title="Switch to ' +
                    (pref.theme === 'dark' ? 'light' : 'dark') + ' mode">' +
                    (pref.theme === 'dark' ? '&#9728;' : '&#9790;') + '</button>' +
                '<button class="nav-burger" type="button" data-nav-burger aria-label="Menu" aria-controls="nav-menu" aria-expanded="' + navMenuOpen + '">' + burger + '</button>' +
            '</span>' +
            '<div class="nav-menu" id="nav-menu"' + (navMenuOpen ? '' : ' hidden') + '>' + tabButtonsHtml() + '</div>';
        updateNavCollapse();
        if (focusSelector) {
            var candidates = navEl.querySelectorAll(focusSelector);
            var restored = Array.prototype.find.call(candidates, function (node) { return node.offsetParent !== null; });
            if (!restored && navEl.classList.contains('nav-collapsed')) restored = navEl.querySelector('[data-nav-burger]');
            if (!restored) {
                restored = Array.prototype.find.call(
                    navEl.querySelectorAll('[data-auth-signin], [data-auth-signout], .nav-tab.active, [data-nav-burger]'),
                    function (node) { return node.offsetParent !== null; }
                );
            }
            if (restored) restored.focus();
        }
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
            renderNav();
            return;
        }
        document.documentElement.style.setProperty('--app-nav-height', navEl.offsetHeight + 'px');
    }

    function boot() {
        root = document.getElementById('ui-root');
        toastEl = document.getElementById('toast');
        navEl = document.getElementById('app-nav');
        confirmLayer = document.getElementById('confirm-layer');
        confirmPrompt = document.getElementById('confirm-prompt');
        confirmMessage = document.getElementById('confirm-message');
        confirmAccept = confirmLayer.querySelector('[data-confirm-accept]');
        confirmAlternate = confirmLayer.querySelector('[data-confirm-alternate]');
        confirmCancel = confirmLayer.querySelector('[data-confirm-cancel]');
        confirmInput = document.getElementById('confirm-input');
        confirmInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') closeConfirm(true);
        });

        loadPref();
        FireStore.init();
        TrackerStore.init();
        if (pref.mode !== 'beginner' && pref.mode !== 'expert') {
            pref.mode = FireStore.isDefault() && TrackerStore.isEmpty() ? 'beginner' : 'expert';
            pref.view = currentEntry().ui.id;
            savePref();
        }
        applyMode();
        compute();

        navEl.addEventListener('click', function (e) {
            if (e.target.dataset.view) {
                navMenuOpen = false;
                // setView no-ops on the current tab; still close the menu
                if (pref.view === e.target.dataset.view) renderNav();
                else setView(e.target.dataset.view);
            }
            if (e.target.closest('[data-nav-burger]')) { navMenuOpen = !navMenuOpen; renderNav(); }
            var modeButton = e.target.closest('[data-mode-set]');
            if (modeButton) setMode(modeButton.dataset.modeSet);
            if (e.target.closest('[data-theme-toggle]')) toggleTheme();
            if (e.target.closest('[data-auth-signin]')) FireCloud.signIn();
            if (e.target.closest('[data-auth-signout]')) FireCloud.signOut();
            if (e.target.closest('[data-cloud-resolve]')) resolveCloudConflict();
            if (e.target.closest('[data-cloud-retry]')) FireCloud.flush();
        });
        window.addEventListener('resize', updateNavCollapse);
        document.addEventListener('click', function (e) {
            var modeLink = e.target.closest('[data-mode-set]');
            if (modeLink && !navEl.contains(modeLink)) setMode(modeLink.dataset.modeSet);
            // composedPath, not closest: the nav re-renders on burger clicks,
            // so by the time this runs the click target may be detached.
            if (navMenuOpen && e.composedPath().indexOf(navEl) === -1) { navMenuOpen = false; renderNav(); }
        });
        confirmLayer.addEventListener('click', function (e) {
            if (e.target.closest('[data-confirm-accept]')) closeConfirm(true);
            else if (e.target.closest('[data-confirm-alternate]')) closeConfirm(false, true);
            else if (e.target.closest('[data-confirm-cancel]')) closeConfirm(false);
            else if (e.target === confirmLayer && !confirmStrict) closeConfirm(false);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Tab' && pendingConfirm) {
                var focusable = Array.prototype.filter.call(
                    confirmPrompt.querySelectorAll('button:not([disabled]), input:not([disabled])'),
                    function (node) { return node.offsetParent !== null; }
                );
                if (!focusable.length) {
                    e.preventDefault();
                    confirmPrompt.focus();
                } else if (e.shiftKey && document.activeElement === focusable[0]) {
                    e.preventDefault();
                    focusable[focusable.length - 1].focus();
                } else if (!e.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
                    e.preventDefault();
                    focusable[0].focus();
                }
            } else if (e.key === 'Escape' && pendingConfirm && !confirmStrict) closeConfirm(false);
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
            if (FireCloud.onStatus) FireCloud.onStatus(function () { renderNav(); });
            FireCloud.init();
        }

        var loopback = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ||
            location.hostname === '[::1]';
        if ('serviceWorker' in navigator && (location.protocol === 'https:' || loopback)) {
            navigator.serviceWorker.register('./sw.js').catch(function () {});
        }
    }

    global.FireUIs = global.FireUIs || [];
    global.TrackerUIs = global.TrackerUIs || [];
    global.FireApp = {
        boot: boot,
        // Remount the active tab after an external state replacement.
        refresh: function () { if (root) mountActive(); },
        toast: toast,
        confirm: askConfirm,
        prompt: askPrompt,
        verdicts: verdicts,
        results: function () { return results; },
        mode: function () { return pref.mode; },
        setMode: setMode,
        startYear: function () { return startYear; },
        confirmReset: function () {
            askConfirm('Reset all plan data to defaults?', function () {
                if (global.FireForms) FireForms.cancelPending();
                FireStore.reset();
                toast('Plan reset to defaults');
            }, 'Reset');
        }
    };

    document.addEventListener('DOMContentLoaded', boot);

})(typeof window !== 'undefined' ? window : globalThis);
