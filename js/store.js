/* FireStore — normalized plan state and persistence. */
(function (global) {
    'use strict';

    var KEY = 'fireData_v3';
    var listeners = [];
    var state = null;

    function defaultInputs() {
        return FireEngine.normalizeInputs(FireEngine.DEFAULTS);
    }

    function phaseSplit(p) {
        var deferred = Number(p && p.deferred);
        var free = Number(p && p.free);
        deferred = Number.isFinite(deferred) ? Math.max(0, Math.min(100, deferred)) : 0;
        free = Number.isFinite(free) ? Math.max(0, Math.min(100 - deferred, free)) : 0;
        return { deferred: deferred, free: free, taxable: 100 - deferred - free };
    }

    function normalizePhases(phases, currentAge) {
        var source = Array.isArray(phases) ? phases : [];
        var candidates = [];
        var lockedId = null;

        source.forEach(function (p, index) {
            if (!p || typeof p !== 'object') return;
            var age = Number(p.age);
            if (!Number.isFinite(age)) return;
            age = Math.max(0, Math.min(FireEngine.MAX_AGE, Math.round(age)));
            var id = Number(p.id);
            id = Number.isFinite(id) && id > 0 ? Math.round(id) : null;
            var split = phaseSplit(p);
            var item = {
                id: id, age: age, deferred: split.deferred, free: split.free,
                taxable: split.taxable, index: index
            };
            candidates.push(item);
            if (p.isLocked && lockedId === null && id !== null) lockedId = id;
        });

        candidates.sort(function (a, b) { return a.age - b.age || a.index - b.index; });
        var active = null;
        candidates.forEach(function (p) { if (p.age <= currentAge) active = p; });
        var base = active || phaseSplit(FireEngine.DEFAULT_PHASES[0]);
        var usedIds = {};
        var nextId = 1;

        candidates.forEach(function (p) { if (p.id && p.id >= nextId) nextId = p.id + 1; });
        function uniqueId(preferred) {
            var id = preferred;
            if (!id || usedIds[id]) {
                while (usedIds[nextId]) nextId++;
                id = nextId++;
            }
            usedIds[id] = true;
            return id;
        }

        var result = [{
            id: uniqueId(lockedId || (active && active.id) || 1),
            age: currentAge,
            deferred: base.deferred,
            free: base.free,
            taxable: base.taxable,
            isLocked: true
        }];

        var futureByAge = {};
        candidates.forEach(function (p) { if (p.age > currentAge) futureByAge[p.age] = p; });
        Object.keys(futureByAge).map(Number).sort(function (a, b) { return a - b; }).forEach(function (age) {
            var p = futureByAge[age];
            result.push({
                id: uniqueId(p.id), age: age, deferred: p.deferred, free: p.free,
                taxable: p.taxable, isLocked: false
            });
        });
        return result;
    }

    function defaults() {
        var inputs = defaultInputs();
        return {
            inputs: inputs,
            profile: { birthDate: null },
            phases: normalizePhases(FireEngine.DEFAULT_PHASES, inputs.currentAge),
            mcSeed: 1337
        };
    }

    function validBirthDate(value) {
        if (!value) return null;
        var text = String(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
        var parts = text.split('-').map(Number);
        var date = new Date(text + 'T00:00:00');
        if (isNaN(date.getTime()) || date.getFullYear() !== parts[0] ||
            date.getMonth() + 1 !== parts[1] || date.getDate() !== parts[2]) return null;
        var age = FireUtil.ageFromDOB(text);
        return age !== null && age <= FireEngine.MAX_AGE ? text : null;
    }

    function applyBirthDate(st) {
        var age = FireUtil.ageFromDOB(st.profile.birthDate);
        if (age === null || age > FireEngine.MAX_AGE) age = FireEngine.DEFAULTS.currentAge;
        st.inputs.currentAge = age;
        st.phases = normalizePhases(st.phases, age);
    }

    function adopt(saved) {
        var st = defaults();
        if (!saved || typeof saved !== 'object') return st;
        st.inputs = FireEngine.normalizeInputs(saved.inputs);
        st.profile.birthDate = validBirthDate(saved.profile && saved.profile.birthDate);
        st.phases = normalizePhases(saved.phases, st.inputs.currentAge);
        applyBirthDate(st);
        var seed = Number(saved.mcSeed);
        if (Number.isFinite(seed)) st.mcSeed = Math.trunc(seed);
        return st;
    }

    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (raw) return adopt(JSON.parse(raw));
        } catch (e) { /* defaults */ }
        return defaults();
    }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* unavailable */ }
    }

    function commit() {
        save();
        listeners.slice().forEach(function (fn) { fn(state); });
    }

    function normalizeScalar(key, value, fallback) {
        var rule = FireEngine.INPUT_RULES[key];
        var n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        if (rule.integer) n = Math.round(n);
        return Math.max(rule.min, Math.min(rule.max, n));
    }

    function adjustSingleDraw(candidate, patch, keys) {
        var edited = keys.filter(function (key) {
            return Object.prototype.hasOwnProperty.call(patch, key) && Number.isFinite(Number(patch[key]));
        });
        if (edited.length !== 1) return;
        var key = edited[0];
        var value = normalizeScalar(key, patch[key], candidate[key]);
        var others = keys.filter(function (k) { return k !== key; });
        var remaining = 100 - value;
        var otherTotal = candidate[others[0]] + candidate[others[1]];
        candidate[key] = value;
        if (otherTotal > 0) {
            candidate[others[0]] = remaining * candidate[others[0]] / otherTotal;
            candidate[others[1]] = remaining - candidate[others[0]];
        } else {
            candidate[others[0]] = remaining;
            candidate[others[1]] = 0;
        }
    }

    function setInputs(patch) {
        if (!patch || typeof patch !== 'object') return false;
        var candidate = Object.assign({}, state.inputs);
        var changed = false;
        for (var key in patch) {
            if (!Object.prototype.hasOwnProperty.call(FireEngine.DEFAULTS, key)) continue;
            var value = Number(patch[key]);
            if (!Number.isFinite(value)) continue;
            candidate[key] = value;
            changed = true;
        }
        if (!changed) return false;

        FireEngine.DRAW_SETS.forEach(function (keys) { adjustSingleDraw(candidate, patch, keys); });
        candidate = FireEngine.normalizeInputs(candidate);
        if (state.profile.birthDate) candidate.currentAge = FireUtil.ageFromDOB(state.profile.birthDate);
        state.inputs = candidate;
        state.phases = normalizePhases(state.phases, candidate.currentAge);
        commit();
        return true;
    }

    global.FireStore = {
        init: function () { state = load(); },
        get: function () { return state; },
        replace: function (obj) { state = adopt(obj); commit(); },

        isDefault: function () {
            var d = defaults();
            return JSON.stringify([state.inputs, state.profile, state.phases]) ===
                JSON.stringify([d.inputs, d.profile, d.phases]);
        },

        setInput: function (key, value) {
            var patch = {};
            patch[key] = value;
            return setInputs(patch);
        },

        setInputs: setInputs,

        setProfile: function (field, value) {
            if (field !== 'birthDate') return;
            state.profile.birthDate = validBirthDate(value);
            applyBirthDate(state);
            commit();
        },

        age: function () { return FireUtil.ageFromDOB(state.profile.birthDate); },

        setPhases: function (phases) {
            state.phases = normalizePhases(phases, state.inputs.currentAge);
            commit();
        },

        addPhase: function () {
            var prev = state.phases[state.phases.length - 1];
            if (prev.age >= FireEngine.MAX_AGE) return;
            var maxId = state.phases.reduce(function (m, p) { return Math.max(m, p.id); }, 0);
            state.phases.push({
                id: maxId + 1,
                age: Math.min(FireEngine.MAX_AGE, prev.age + 5),
                deferred: 0, free: 0, taxable: 100, isLocked: false
            });
            state.phases = normalizePhases(state.phases, state.inputs.currentAge);
            commit();
        },

        removePhase: function (id) {
            var phase = state.phases.filter(function (p) { return p.id === id; })[0];
            if (!phase || phase.isLocked) return;
            state.phases = normalizePhases(state.phases.filter(function (p) { return p.id !== id; }), state.inputs.currentAge);
            commit();
        },

        updatePhase: function (id, field, value) {
            var phase = state.phases.filter(function (p) { return p.id === id; })[0];
            if (!phase || !Number.isFinite(Number(value))) return;
            var v = Number(value);
            if (field === 'age') {
                if (phase.isLocked) return;
                phase.age = Math.max(state.inputs.currentAge + 1, Math.min(FireEngine.MAX_AGE, Math.round(v)));
            } else if (field === 'deferred' || field === 'free') {
                v = Math.max(0, Math.min(100, v));
                var other = field === 'deferred' ? 'free' : 'deferred';
                phase[field] = Math.min(v, 100 - phase[other]);
                phase.taxable = 100 - phase.deferred - phase.free;
            } else {
                return;
            }
            state.phases = normalizePhases(state.phases, state.inputs.currentAge);
            commit();
        },

        rerollSeed: function () {
            state.mcSeed = (state.mcSeed * 16807 + 12345) % 2147483647;
            if (!state.mcSeed) state.mcSeed = 1337;
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
