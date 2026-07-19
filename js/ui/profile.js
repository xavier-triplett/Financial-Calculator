/* UI: PROFILE — the baseline every tab builds on. Date of birth (which
 * drives your age), income, spending and the two retirement ages live here;
 * the Planner keeps the simulation dials. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var els = {};

    function template() {
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
                    '<label class="pf-eyebrow" for="pf-dob">Date of birth</label>' +
                    '<input id="pf-dob" class="pf-dob" type="date" data-el="dob" max="9999-12-31">' +
                    '<p class="pf-hero-note">Your age is derived from this, and used everywhere.</p>' +
                '</div>' +
                '<div class="pf-hero-age">' +
                    '<span class="pf-eyebrow">Current age</span>' +
                    '<div class="pf-age" data-el="age">&mdash;</div>' +
                    '<p class="pf-hero-note" data-el="ageNote"></p>' +
                '</div>' +
            '</section>' +

            '<section class="pf-card">' +
                '<div class="pf-card-title">Baseline factors</div>' +
                '<p class="pf-help">Income, spending, your target ages, withdrawal tax rates and the IRS contribution limits. The trackers measure against these; the Planner projects from them.</p>' +
                '<div data-el="groups"></div>' +
            '</section>' +
        '</div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = {};
        root.querySelectorAll('[data-el]').forEach(function (n) { els[n.getAttribute('data-el')] = n; });
        els.root = root;

        FireForms.buildGroups(els.groups, { groups: FireSchema.profileGroups });

        els.dob.addEventListener('change', function () { FireStore.setProfile('birthDate', els.dob.value); });
        els.dobPicker = U.datePicker(els.dob, {
            dateFormat: 'Y-m-d', altInput: true, altFormat: 'F j, Y',
            maxDate: 'today', disableMobile: true
        });
        els.reset.addEventListener('click', FireApp.confirmReset);
    }

    function update(state) {
        var dob = state.profile.birthDate || '';
        if (els.dobPicker && !els.dobPicker.isOpen && els.dob.value !== dob) els.dobPicker.setDate(dob || null, false);

        var age = U.ageFromDOB(dob);
        els.age.textContent = age === null ? '—' : age;

        if (age === null) {
            els.ageNote.textContent = 'Set your birth date to place yourself on the timeline.';
        } else {
            var toEarly = state.inputs.retireAge - age;
            els.ageNote.textContent = toEarly > 0
                ? 'Early retirement at ' + state.inputs.retireAge + ' is ' + toEarly + ' year' + (toEarly === 1 ? '' : 's') + ' away.'
                : 'You are at or past your early-retirement age of ' + state.inputs.retireAge + '.';
        }

        FireForms.syncInputs(els.root);
    }

    function unmount() { if (els.dobPicker) els.dobPicker.destroy(); els = {}; }

    (global.FireUIs = global.FireUIs || []).push({
        id: 'profile', name: 'Profile', tag: 'The baseline every tab builds on',
        mount: mount, update: update, unmount: unmount
    });

})(window);
