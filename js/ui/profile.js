/* UI: PROFILE — the baseline every tab builds on. Date of birth (which
 * drives your age), income, spending and retirement milestones live here;
 * the Planner keeps the simulation dials. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var els = {};

    function pathOptions() {
        return FireSchema.planTypes.map(function (type) {
            return '<button class="pf-path" type="button" role="radio" aria-checked="false" data-plan-type="' + type.id + '">' +
                '<span class="pf-path-name">' + type.name + '</span>' +
                '<span class="pf-path-desc">' + type.description + '</span>' +
            '</button>';
        }).join('');
    }

    function template() {
        var beginner = FireApp.mode() === 'beginner';
        return '' +
        '<div class="pf-shell">' +
            '<header class="pf-masthead">' +
                '<div>' +
                    '<span class="pf-eyebrow">Your baseline</span>' +
                    '<h1>Profile</h1>' +
                    '<span class="pf-sub">The facts every tab builds on &mdash; the Planner and trackers all read from here</span>' +
                '</div>' +
                '<button class="pf-reset" type="button" data-el="reset">Reset plan</button>' +
            '</header>' +

            '<section class="pf-hero">' +
                '<div class="pf-hero-field">' +
                    '<label class="pf-eyebrow" id="pf-dob-label" for="pf-dob">Date of birth</label>' +
                    '<input id="pf-dob" class="pf-dob" type="date" data-el="dob" aria-labelledby="pf-dob-label">' +
                    '<p class="pf-hero-note">Your age is derived from this, and used everywhere.</p>' +
                '</div>' +
                '<div class="pf-hero-age">' +
                    '<span class="pf-eyebrow">Current age</span>' +
                    '<div class="pf-age" data-el="age">&mdash;</div>' +
                    '<p class="pf-hero-note" data-el="ageNote"></p>' +
                '</div>' +
            '</section>' +

            '<section class="pf-card pf-path-card">' +
                '<div class="pf-card-title">Choose your retirement path</div>' +
                '<p class="pf-help">This changes how the projection treats your working and saving years.</p>' +
                '<div class="pf-paths" role="radiogroup" aria-label="Retirement path">' + pathOptions() + '</div>' +
                '<p class="pf-path-note" data-el="pathNote"></p>' +
            '</section>' +

            '<section class="pf-card">' +
                '<div class="pf-card-title">Baseline factors</div>' +
                '<p class="pf-help">' + (beginner
                    ? 'Enter the few facts that shape your plan. Standard tax and contribution assumptions keep the rest ready for you.'
                    : 'Income, spending, your target ages, withdrawal tax rates and the IRS contribution limits. The trackers measure against these; the Planner projects from them.') + '</p>' +
                '<div data-el="groups"></div>' +
                '<p class="mode-note" data-el="assumptions"' + (beginner ? '' : ' hidden') + '></p>' +
            '</section>' +
        '</div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = {};
        root.querySelectorAll('[data-el]').forEach(function (n) { els[n.getAttribute('data-el')] = n; });
        els.root = root;

        FireForms.buildGroups(els.groups, { groups: FireSchema.profileGroups });

        root.querySelectorAll('[data-plan-type]').forEach(function (button) {
            button.addEventListener('click', function () {
                FireStore.setInput('planType', Number(button.getAttribute('data-plan-type')));
            });
        });

        els.dob.addEventListener('change', function () { FireStore.setProfile('birthDate', els.dob.value); });
        els.dobPicker = U.datePicker(els.dob, {
            dateFormat: 'Y-m-d', altInput: true, altFormat: 'F j, Y',
            maxDate: 'today', yearRange: [new Date().getFullYear() - 95, new Date().getFullYear()]
        });
        if (els.dobPicker.altInput) {
            els.dobPicker.altInput.id = 'pf-dob-visible';
            els.dobPicker.altInput.setAttribute('aria-labelledby', 'pf-dob-label');
            document.getElementById('pf-dob-label').setAttribute('for', 'pf-dob-visible');
        }
        els.reset.addEventListener('click', FireApp.confirmReset);
    }

    function update(state) {
        var dob = state.profile.birthDate || '';
        if (els.dobPicker && !els.dobPicker.isOpen && els.dob.value !== dob) els.dobPicker.setDate(dob || null, false);

        var age = U.ageFromDOB(dob);
        els.age.textContent = age === null ? '—' : age;

        var plan = FireSchema.planType(state.inputs.planType);
        var coast = state.inputs.planType === FireEngine.PLAN_TYPES.COAST;
        els.root.setAttribute('data-plan-type', state.inputs.planType);
        els.root.querySelectorAll('[data-plan-type]').forEach(function (button) {
            var selected = Number(button.getAttribute('data-plan-type')) === state.inputs.planType;
            button.classList.toggle('selected', selected);
            button.setAttribute('aria-checked', String(selected));
        });

        var coastField = els.root.querySelector('.ff-field[data-key="coastAge"]');
        if (coastField) coastField.hidden = !coast;
        var retirementLabel = els.root.querySelector('.ff-field[data-key="retireAge"] .ff-label-text');
        if (retirementLabel) {
            retirementLabel.textContent = coast ? 'Full retirement age' :
                (state.inputs.planType === FireEngine.PLAN_TYPES.EARLY ? 'Early retirement age' : 'Retirement age');
        }

        if (coast) {
            els.pathNote.textContent = 'Save through age ' + (state.inputs.coastAge - 1) + ', coast from ' +
                state.inputs.coastAge + ' to ' + state.inputs.retireAge + ', then retire fully.';
        } else if (state.inputs.planType === FireEngine.PLAN_TYPES.EARLY) {
            els.pathNote.textContent = 'Save until age ' + state.inputs.retireAge + ', then use the bridge until accounts unlock at ' +
                state.inputs.standardRetireAge + '.';
        } else {
            els.pathNote.textContent = 'Keep contributing until retirement at age ' + state.inputs.retireAge + '.';
        }

        if (age === null) {
            els.ageNote.textContent = 'Set your birth date to place yourself on the timeline.';
        } else {
            var nextAge = coast && age < state.inputs.coastAge ? state.inputs.coastAge : state.inputs.retireAge;
            var milestone = coast && age < state.inputs.coastAge ? 'Coasting' : 'Retirement';
            var years = nextAge - age;
            els.ageNote.textContent = years > 0
                ? milestone + ' at ' + nextAge + ' is ' + years + ' year' + (years === 1 ? '' : 's') + ' away.'
                : 'You are at or past the ' + plan.short.toLowerCase() + ' retirement milestone.';
        }

        FireForms.syncInputs(els.root);
        if (FireApp.mode() === 'beginner') {
            els.assumptions.innerHTML = FireSchema.assumptionsText(state) +
                ' <button type="button" data-mode-set="expert">Open Expert mode</button> to change them.';
        }
    }

    function unmount() { if (els.dobPicker) els.dobPicker.destroy(); els = {}; }

    (global.FireUIs = global.FireUIs || []).push({
        id: 'profile', name: 'Profile', tag: 'The baseline every tab builds on',
        mount: mount, update: update, unmount: unmount
    });

})(window);
