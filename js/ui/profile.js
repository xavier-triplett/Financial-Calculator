/* UI: PROFILE — the baseline every tab builds on. Date of birth (which
 * drives your age), income, spending and retirement milestones live here;
 * the Planner keeps the simulation dials. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var els = {};

    function pathOptions() {
        return FireSchema.planTypes.map(function (type) {
            return '<button class="pf-path" type="button" role="radio" aria-checked="false" tabindex="-1" data-plan-type="' + type.id + '">' +
                '<span class="pf-path-name">' + type.name + '</span>' +
                '<span class="pf-path-desc">' + type.description + '</span>' +
            '</button>';
        }).join('');
    }

    function selectPath(button) {
        FireStore.setInput('planType', Number(button.getAttribute('data-plan-type')));
    }

    function pathKeydown(event) {
        var buttons = Array.prototype.slice.call(
            event.currentTarget.parentNode.querySelectorAll('[data-plan-type]')
        );
        var index = buttons.indexOf(event.currentTarget);
        var next = null;

        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else if (event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            selectPath(event.currentTarget);
            return;
        }

        if (next === null) return;
        event.preventDefault();
        buttons[next].focus();
        selectPath(buttons[next]);
    }

    /* Beginner states its assumptions instead of hiding them: the model is
     * fixed, so it can be read off the page in full. */
    function assumptionsHtml() {
        return '<section class="pf-card pf-assumptions">' +
            '<div class="pf-card-title">The standard assumptions</div>' +
            '<p class="pf-help">Beginner mode runs one simple model, the same one for everybody. ' +
                'These are not editable here &mdash; that is the point. ' +
                '<button type="button" data-mode-set="expert">Switch to Expert</button> to set your own.</p>' +
            '<dl class="pf-assume-list">' +
                FireEngine.beginnerAssumptions().map(function (a) {
                    return '<div class="pf-assume">' +
                        '<dt>' + a.label + '</dt>' +
                        '<dd><span class="pf-assume-value">' + a.value + '</span>' +
                        '<span class="pf-assume-note">' + a.note + '</span></dd>' +
                    '</div>';
                }).join('') +
            '</dl>' +
        '</section>';
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
                    ? 'The handful of facts the simple model needs. Everything else is fixed, and listed below.'
                    : 'Income, spending, your target ages, withdrawal tax rates and the IRS contribution limits. The trackers measure against these; the Planner projects from them.') + '</p>' +
                '<div data-el="groups"></div>' +
            '</section>' +

            (beginner ? assumptionsHtml() : '') +
        '</div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = {};
        root.querySelectorAll('[data-el]').forEach(function (n) { els[n.getAttribute('data-el')] = n; });
        els.root = root;

        FireForms.buildGroups(els.groups, { groups: FireSchema.profileGroups });

        root.querySelectorAll('[data-plan-type]').forEach(function (button) {
            button.addEventListener('click', function () { selectPath(button); });
            button.addEventListener('keydown', pathKeydown);
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
        var inputs = FireApp.inputs();
        var dob = state.profile.birthDate || '';
        if (els.dobPicker && !els.dobPicker.isOpen && els.dob.value !== dob) els.dobPicker.setDate(dob || null, false);

        var age = U.ageFromDOB(dob);
        els.age.textContent = age === null ? '—' : age;

        var plan = FireSchema.planType(inputs.planType);
        var coast = inputs.planType === FireEngine.PLAN_TYPES.COAST;
        els.root.setAttribute('data-plan-type', inputs.planType);
        els.root.querySelectorAll('[data-plan-type]').forEach(function (button) {
            var selected = Number(button.getAttribute('data-plan-type')) === inputs.planType;
            button.classList.toggle('selected', selected);
            button.setAttribute('aria-checked', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });

        var coastField = els.root.querySelector('.ff-field[data-key="coastAge"]');
        if (coastField) coastField.hidden = !coast;
        var retirementLabel = els.root.querySelector('.ff-field[data-key="retireAge"] .ff-label-text');
        if (retirementLabel) {
            retirementLabel.textContent = coast ? 'Full retirement age' :
                (inputs.planType === FireEngine.PLAN_TYPES.EARLY ? 'Early retirement age' : 'Retirement age');
        }

        if (coast) {
            els.pathNote.textContent = 'Save through age ' + (inputs.coastAge - 1) + ', coast from ' +
                inputs.coastAge + ' to ' + inputs.retireAge + ', then retire fully.';
        } else if (inputs.planType === FireEngine.PLAN_TYPES.EARLY) {
            els.pathNote.textContent = 'Save until age ' + inputs.retireAge + ', then use the bridge until accounts unlock at ' +
                inputs.standardRetireAge + '.';
        } else {
            els.pathNote.textContent = 'Keep contributing until retirement at age ' + inputs.retireAge + '.';
        }

        if (age === null) {
            els.ageNote.textContent = 'Set your birth date to place yourself on the timeline.';
        } else {
            var nextAge = coast && age < inputs.coastAge ? inputs.coastAge : inputs.retireAge;
            var milestone = coast && age < inputs.coastAge ? 'Coasting' : 'Retirement';
            var years = nextAge - age;
            els.ageNote.textContent = years > 0
                ? milestone + ' at ' + nextAge + ' is ' + years + ' year' + (years === 1 ? '' : 's') + ' away.'
                : 'You are at or past the ' + plan.short.toLowerCase() + ' retirement milestone.';
        }

        FireForms.syncInputs(els.root);
    }

    function unmount() { if (els.dobPicker) els.dobPicker.destroy(); els = {}; }

    (global.FireUIs = global.FireUIs || []).push({
        id: 'profile', name: 'Profile', tag: 'The baseline every tab builds on',
        mount: mount, update: update, unmount: unmount
    });

})(window);
