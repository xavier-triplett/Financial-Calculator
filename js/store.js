/* FireStore — single source of truth: inputs, phases, persistence.
 * Saved data carries no compatibility guarantees: anything unreadable or
 * stale simply falls back to defaults. */
(function (global) {
    'use strict';

    // Bump the version to discard every existing save (they carry no
    // compatibility guarantees).
    var KEY = 'fireData_v3';

    var listeners = [];
    var state = null;

    function defaults() {
        var inputs = {};
        for (var k in FireEngine.DEFAULTS) inputs[k] = FireEngine.DEFAULTS[k];
        return {
            inputs: inputs,
            // Date of birth is the single source of truth for age; inputs.currentAge
            // is kept derived from it so the engine stays untouched.
            profile: { birthDate: null },
            phases: FireEngine.DEFAULT_PHASES.map(function (p) { return Object.assign({}, p); }),
            mcSeed: 1337
        };
    }

    /* Push the derived age from a birth date into inputs.currentAge (and the
     * locked first phase). No-op when the date is missing/invalid. */
    function applyBirthDate(st) {
        var age = FireUtil.ageFromDOB(st.profile.birthDate);
        if (age === null) return;
        st.inputs.currentAge = age;
        if (st.phases.length) st.phases[0].age = age;
    }

    /* Build a clean state from an untrusted saved object, defensively —
     * anything missing or malformed falls back to defaults. Shared by the
     * localStorage load path and the cloud adopt path. */
    function adopt(saved) {
        var st = defaults();
        if (!saved || typeof saved !== 'object') return st;
        if (saved.inputs) {
            for (var k in saved.inputs) {
                if (st.inputs[k] !== undefined && !isNaN(Number(saved.inputs[k]))) {
                    st.inputs[k] = Number(saved.inputs[k]);
                }
            }
        }
        if (saved.profile && saved.profile.birthDate) st.profile.birthDate = String(saved.profile.birthDate);
        if (saved.phases && saved.phases.length) st.phases = saved.phases;
        if (saved.mcSeed) st.mcSeed = saved.mcSeed;
        applyBirthDate(st);
        return st;
    }

    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (raw) return adopt(JSON.parse(raw));
        } catch (e) { /* fall through to defaults */ }
        return defaults();
    }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
    }

    function notify() {
        listeners.forEach(function (fn) { fn(state); });
    }

    function commit() { save(); notify(); }

    global.FireStore = {
        init: function () { state = load(); },
        get: function () { return state; },

        /* Adopt a full state from outside (e.g. a signed-in user's cloud
         * document). Caches to localStorage and notifies so the UI redraws. */
        replace: function (obj) { state = adopt(obj); commit(); },

        /* True while the plan still matches the shipped defaults (the
         * Monte Carlo seed alone does not count as data). */
        isDefault: function () {
            var d = defaults();
            return JSON.stringify([state.inputs, state.profile, state.phases]) ===
                JSON.stringify([d.inputs, d.profile, d.phases]);
        },

        setInput: function (key, value) {
            var v = Number(value);
            if (isNaN(v)) return;
            state.inputs[key] = v;
            // Phase 1 always starts at the current age
            if (key === 'currentAge' && state.phases.length) state.phases[0].age = v;
            commit();
        },

        /* Baseline profile facts. birthDate ('YYYY-MM-DD') drives currentAge. */
        setProfile: function (field, value) {
            if (field !== 'birthDate') return;
            state.profile.birthDate = value || null;
            applyBirthDate(state);
            commit();
        },

        /* Derived age from the current birth date, or null when unset. */
        age: function () { return FireUtil.ageFromDOB(state.profile.birthDate); },

        setPhases: function (phases) { state.phases = phases; commit(); },

        addPhase: function () {
            var maxId = state.phases.reduce(function (m, p) { return Math.max(m, p.id); }, 0);
            var prev = state.phases[state.phases.length - 1];
            state.phases.push({ id: maxId + 1, age: (prev ? prev.age : state.inputs.currentAge) + 5, deferred: 0, free: 0, taxable: 100, isLocked: false });
            commit();
        },

        removePhase: function (id) {
            state.phases = state.phases.filter(function (p) { return p.id !== id; });
            commit();
        },

        updatePhase: function (id, field, value) {
            var phase = state.phases.filter(function (p) { return p.id === id; })[0];
            if (!phase) return;
            phase[field] = parseInt(value, 10) || 0;
            if (field === 'deferred' || field === 'free') {
                var rem = 100 - phase.deferred - phase.free;
                phase.taxable = rem < 0 ? 0 : rem;
            }
            commit();
        },

        rerollSeed: function () {
            state.mcSeed = (state.mcSeed * 16807 + 12345) % 2147483647;
            commit();
        },

        reset: function () {
            localStorage.removeItem(KEY);
            state = defaults();
            commit();
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
