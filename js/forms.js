/* FireForms — shared, unstyled form builders. Every UI skin styles the
 * ff-* classes in its own visual language. */
(function (global) {
    'use strict';

    var U = global.FireUtil;

    /* ------------------------------------------------------------------
     * Field groups
     * ------------------------------------------------------------------ */
    function buildGroups(container, opts) {
        opts = opts || {};
        var wanted = opts.groups || null; // array of group ids, or null for all
        var state = FireStore.get();

        FireSchema.groups.forEach(function (group) {
            if (wanted && wanted.indexOf(group.id) === -1) return;

            var head = U.el('button', { class: 'ff-group-head', type: 'button' }, [
                U.el('span', { class: 'ff-group-icon', html: group.icon || '' }),
                U.el('span', { class: 'ff-group-title', text: group.title }),
                U.el('span', { class: 'ff-group-caret' })
            ]);
            var body = U.el('div', { class: 'ff-group-body' });
            if (group.blurb) body.appendChild(U.el('p', { class: 'ff-group-blurb', text: group.blurb }));

            var fieldsWrap = U.el('div', { class: 'ff-fields' });
            group.fields.forEach(function (f) {
                fieldsWrap.appendChild(buildField(f, state));
            });
            body.appendChild(fieldsWrap);

            var groupEl = U.el('div', { class: 'ff-group' + (opts.collapsed ? '' : ' open'), 'data-group': group.id }, [head, body]);
            head.addEventListener('click', function () { groupEl.classList.toggle('open'); });
            container.appendChild(groupEl);
        });
    }

    function buildField(f, state) {
        // Dollar fields render as grouped US currency; the "$" unit chip beside
        // them already supplies the symbol, so the value itself carries commas.
        var money = f.unit === '$';
        var input = U.el('input', {
            type: money ? 'text' : 'number',
            value: state.inputs[f.key],
            'data-key': f.key
        });
        if (!money) input.setAttribute('step', f.step || 1);
        if (f.min !== undefined) input.setAttribute('min', f.min);
        if (f.max !== undefined) input.setAttribute('max', f.max);
        if (money) U.bindCurrency(input, { prefix: false });

        // Clamp to the schema bounds so the stored value always matches what
        // the engine will actually use.
        function commit() {
            var v = money ? U.parseNum(input.value) : (input.value === '' ? null : Number(input.value));
            if (v === null || isNaN(v)) return;
            if (f.min !== undefined && v < f.min) v = f.min;
            if (f.max !== undefined && v > f.max) v = f.max;
            FireStore.setInput(f.key, v);
        }

        input.addEventListener('input', U.debounce(commit, 250));
        input.addEventListener('change', function () {
            commit();
            var val = FireStore.get().inputs[f.key];
            if (money) U.setMoneyEl(input, val);
            else if (String(val) !== input.value) input.value = val;
        });

        var labelBits = [U.el('span', { class: 'ff-label-text', text: f.label })];
        if (f.hint) {
            labelBits.push(U.el('span', {
                class: 'ff-hint',
                text: 'i',
                tabindex: '0',
                role: 'img',
                'aria-label': f.hint,
                'data-tooltip': f.hint
            }));
        }

        var control = U.el('span', { class: 'ff-control' }, [
            f.unit ? U.el('span', { class: 'ff-unit', text: f.unit }) : null,
            input
        ]);

        return U.el('label', {
            class: 'ff-field' + (f.bucket ? ' ff-bucket-' + f.bucket : ''),
            'data-key': f.key
        }, [U.el('span', { class: 'ff-label' }, labelBits), control]);
    }

    /* Push current store values back into any rendered inputs that are not
     * focused (e.g. after a reset). */
    function syncInputs(root) {
        var state = FireStore.get();
        root.querySelectorAll('input[data-key]').forEach(function (input) {
            if (document.activeElement === input) return;
            var key = input.getAttribute('data-key');
            var val = state.inputs[key];
            if (val === undefined) return;
            if (input.dataset.money === '1') {
                if (U.parseNum(input.value) !== Number(val)) U.setMoneyEl(input, val);
            } else if (String(val) !== input.value) {
                input.value = val;
            }
        });
    }

    /* ------------------------------------------------------------------
     * Saving phases editor
     * ------------------------------------------------------------------ */
    /* An editor only skips rebuilding while the user is actually typing in
     * one of its inputs. Buttons (add / delete) must never block a rebuild —
     * clicking them focuses the button, and the click is exactly what
     * changed the data being re-rendered. */
    function editingInput(container) {
        var a = document.activeElement;
        return a && a.tagName === 'INPUT' && container.contains(a) ? a : null;
    }

    function renderPhases(container) {
        var state = FireStore.get();

        var focused = editingInput(container);
        if (focused) {
            // Refresh every other input in place (e.g. the Brokerage
            // remainder after an Enter keypress) without yanking focus.
            var byId = {};
            state.phases.forEach(function (p) { byId[p.id] = p; });
            container.querySelectorAll('input[data-phase-id]').forEach(function (input) {
                if (input === focused) return;
                var phase = byId[input.getAttribute('data-phase-id')];
                if (!phase) return;
                var field = input.getAttribute('data-field');
                var val = (field === 'age' && phase.isLocked) ? state.inputs.currentAge : phase[field];
                if (String(val) !== input.value) input.value = val;
            });
            return;
        }

        container.innerHTML = '';

        var phases = state.phases.slice().sort(function (a, b) { return a.age - b.age; });

        phases.forEach(function (phase) {
            var card = U.el('div', { class: 'ff-phase' + (phase.isLocked ? ' locked' : '') });

            var head = U.el('div', { class: 'ff-phase-head' });
            var ageInput = U.el('input', {
                type: 'number', min: '0',
                value: phase.isLocked ? state.inputs.currentAge : phase.age,
                'data-phase-id': phase.id, 'data-field': 'age'
            });
            if (phase.isLocked) ageInput.setAttribute('disabled', 'disabled');
            else ageInput.addEventListener('change', function () { FireStore.updatePhase(phase.id, 'age', ageInput.value); });

            head.appendChild(U.el('span', { class: 'ff-phase-age-label', text: phase.isLocked ? 'From age (now)' : 'From age' }));
            head.appendChild(ageInput);
            if (!phase.isLocked) {
                var del = U.el('button', { class: 'ff-phase-del', type: 'button', title: 'Remove phase', html: '&times;' });
                del.addEventListener('click', function () { FireStore.removePhase(phase.id); });
                head.appendChild(del);
            }
            card.appendChild(head);

            var split = U.el('div', { class: 'ff-phase-split' });
            [['deferred', 'Deferred'], ['free', 'Roth'], ['taxable', 'Brokerage']].forEach(function (pair) {
                var key = pair[0];
                var inp = U.el('input', {
                    type: 'number', value: phase[key],
                    'data-phase-id': phase.id, 'data-field': key
                });
                if (key === 'taxable') inp.setAttribute('readonly', 'readonly');
                else inp.addEventListener('change', function () { FireStore.updatePhase(phase.id, key, inp.value); });
                split.appendChild(U.el('span', { class: 'ff-phase-cell ff-bucket-' + key }, [
                    U.el('span', { class: 'ff-phase-cell-label', text: pair[1] + ' %' }), inp
                ]));
            });
            card.appendChild(split);
            container.appendChild(card);
        });

        var add = U.el('button', { class: 'ff-phase-add', type: 'button', text: '+ Add phase' });
        add.addEventListener('click', function () { FireStore.addPhase(); });
        container.appendChild(add);
    }

    /* ------------------------------------------------------------------
     * Drawdown strategy editor
     * ------------------------------------------------------------------ */
    var DRAW_SETS = [
        { id: 'bridge', title: 'Bridge years', keys: { taxable: 'drawTaxableBridge', deferred: 'drawDeferredBridge', free: 'drawFreeBridge' } },
        { id: 'std', title: 'Standard years', keys: { taxable: 'drawTaxableStd', deferred: 'drawDeferredStd', free: 'drawFreeStd' } }
    ];

    function renderDrawdown(container) {
        var state = FireStore.get();

        var focused = editingInput(container);
        if (focused) {
            container.querySelectorAll('input[data-key]').forEach(function (input) {
                if (input === focused) return;
                var key = input.getAttribute('data-key');
                if (String(state.inputs[key]) !== input.value) input.value = state.inputs[key];
            });
            updateDrawTotals(container);
            return;
        }

        container.innerHTML = '';

        DRAW_SETS.forEach(function (set) {
            var block = U.el('div', { class: 'ff-draw ff-draw-' + set.id, 'data-set': set.id });
            var subtitle = set.id === 'bridge'
                ? 'Age ' + state.inputs.retireAge + '–' + state.inputs.standardRetireAge
                : 'Age ' + state.inputs.standardRetireAge + '+';
            block.appendChild(U.el('div', { class: 'ff-draw-head' }, [
                U.el('span', { class: 'ff-draw-title', text: set.title }),
                U.el('span', { class: 'ff-draw-sub', text: subtitle })
            ]));

            [['taxable', 'Brokerage'], ['deferred', 'Deferred'], ['free', 'Roth']].forEach(function (pair) {
                var key = set.keys[pair[0]];
                var inp = U.el('input', { type: 'number', value: state.inputs[key], 'data-key': key });
                inp.addEventListener('change', function () { FireStore.setInput(key, inp.value); });
                inp.addEventListener('input', function () { updateDrawTotals(container); });
                block.appendChild(U.el('label', { class: 'ff-draw-row ff-bucket-' + pair[0] }, [
                    U.el('span', { class: 'ff-draw-label', text: pair[1] }), inp,
                    U.el('span', { class: 'ff-draw-unit', text: '%' })
                ]));
            });

            block.appendChild(U.el('div', { class: 'ff-draw-total' }, [
                U.el('span', { text: 'Total' }),
                U.el('span', { class: 'ff-draw-total-val', text: '100%' })
            ]));
            container.appendChild(block);
        });
        updateDrawTotals(container);
    }

    function updateDrawTotals(container) {
        DRAW_SETS.forEach(function (set) {
            var block = container.querySelector('[data-set="' + set.id + '"]');
            if (!block) return;
            var total = 0;
            block.querySelectorAll('input').forEach(function (i) { total += parseInt(i.value, 10) || 0; });
            var valEl = block.querySelector('.ff-draw-total-val');
            valEl.textContent = total + '%';
            block.classList.toggle('invalid', total !== 100);
        });
    }

    global.FireForms = {
        buildGroups: buildGroups,
        syncInputs: syncInputs,
        renderPhases: renderPhases,
        renderDrawdown: renderDrawdown
    };

})(typeof window !== 'undefined' ? window : globalThis);
