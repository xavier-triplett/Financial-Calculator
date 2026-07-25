/* UI: CATEGORIES — category types and CSV import column mapping. */
(function (global) {
    'use strict';

    var E = global.TrackerEngine;
    var K = global.TrackerKit;
    var els = {};
    var pendingUpdate = false;

    var KIND_LABELS = {
        income: 'Income',
        transfer: 'Transfer (excluded)',
        saving: 'Savings contribution',
        fixed: 'Fixed expense',
        variable: 'Variable expense',
        spending: 'Spending'
    };

    var CSV_FIELDS = [
        { id: 'date', label: 'Date', hint: 'Date / Original Date' },
        { id: 'name', label: 'Merchant', hint: 'Name / Custom Name' },
        { id: 'amount', label: 'Amount', hint: 'Amount' },
        { id: 'category', label: 'Category', hint: 'Category' },
        { id: 'account', label: 'Account', hint: 'Account Name' }
    ];

    function template() {
        return '<div class="trk-shell">' +
            '<header class="trk-masthead"><div>' +
                '<span class="trk-eyebrow">Cashbook configuration</span>' +
                '<h1>Categories</h1>' +
                '<span class="trk-sub">Keep transaction types consistent and map CSV columns</span>' +
            '</div><div class="trk-mast-actions" data-el="actions"></div></header>' +
            '<div data-el="body"></div></div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = {
            root: root,
            body: root.querySelector('[data-el="body"]'),
            actions: root.querySelector('[data-el="actions"]')
        };
        els.actions.appendChild(K.templateButton());
        wire();
        els.body.addEventListener('focusout', function () {
            if (!pendingUpdate) return;
            setTimeout(function () {
                if (!els.body) return;
                var active = document.activeElement;
                if (active && active.tagName === 'INPUT' && els.body.contains(active)) return;
                pendingUpdate = false;
                update(TrackerStore.get());
            }, 0);
        });
    }

    function knownCategories(state) {
        var byFold = {};
        function add(category, preferred) {
            var cat = String(category || '').trim();
            if (!cat) return;
            var key = cat.toLowerCase();
            if (!byFold[key] || preferred) byFold[key] = cat;
        }
        for (var kind in E.KIND) E.KIND[kind].forEach(function (category) { add(category, false); });
        state.txns.forEach(function (transaction) { add(transaction.category, false); });
        Object.keys(state.categoryKinds).forEach(function (category) { add(category, true); });
        return Object.keys(byFold).map(function (key) { return byFold[key]; }).sort(function (a, b) {
            return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
        });
    }

    function kindOptions(category, selected) {
        return E.KINDS.map(function (kind) {
            var label = KIND_LABELS[kind] + (kind === E.defaultKind(category) ? ' — default' : '');
            return '<option value="' + kind + '"' + (kind === selected ? ' selected' : '') + '>' + label + '</option>';
        }).join('');
    }

    function categoryRows(state) {
        var customByFold = {};
        Object.keys(state.categoryKinds).forEach(function (category) {
            customByFold[category.toLowerCase()] = true;
        });
        return knownCategories(state).map(function (category) {
            var kind = E.categoryKind(category);
            var custom = !!customByFold[category.toLowerCase()];
            return '<tr><td>' + escapeHtml(category) +
                (custom ? ' <em class="trk-est">custom</em>' : '') + '</td>' +
                '<td><span class="trk-badge trk-badge-' + kind + '">' + KIND_LABELS[kind] + '</span></td>' +
                '<td><select class="trk-select" aria-label="Classification for ' + escapeHtml(category) +
                    '" data-cat="' + escapeHtml(category) + '">' + kindOptions(category, kind) + '</select></td></tr>';
        }).join('');
    }

    function update(state) {
        var active = document.activeElement;
        if (active && active.tagName === 'INPUT' && els.root.contains(active)) {
            pendingUpdate = true;
            return;
        }
        pendingUpdate = false;

        els.body.innerHTML = '<div class="trk-set-cols">' +
            '<section class="trk-panel"><div class="trk-panel-head"><h2>Category types</h2>' +
                '<span class="trk-panel-note">how each category counts in the statement</span></div>' +
                '<p class="trk-set-blurb">Income adds, expenses subtract, and transfers are excluded so movement between your own accounts is not spending. ' +
                    'Savings contributions count as money deliberately set aside. Unlisted categories count as spending; change any category here.</p>' +
                '<div class="trk-cat-add"><label class="trk-cat-field"><span>Category name</span>' +
                    '<input class="trk-search" type="text" placeholder="e.g. Childcare" data-el="newCat"></label>' +
                    '<label class="trk-cat-field"><span>Counts as</span><select class="trk-select" data-el="newKind">' +
                        kindOptions('', 'spending') + '</select></label>' +
                    '<button class="trk-btn trk-btn-primary" type="button" data-act="addCat">Set type</button></div>' +
                '<div class="trk-regwrap"><table class="trk-register"><caption class="trk-sr-only">Category classifications</caption>' +
                    '<thead><tr><th scope="col">Category</th><th scope="col">Counts as</th><th scope="col">Change</th></tr></thead>' +
                    '<tbody>' + categoryRows(state) + '</tbody></table></div></section>' +
            '<section class="trk-panel"><div class="trk-panel-head"><h2>CSV import columns</h2>' +
                '<span class="trk-panel-note">for non&#8209;Rocket&#8209;Money exports</span></div>' +
                '<p class="trk-set-blurb">If your bank uses different headers, point each field at the matching column. ' +
                    'Leave a field blank to use the grey default. Extra columns are ignored.</p>' +
                '<div class="trk-set-fields">' + CSV_FIELDS.map(function (field) {
                    return '<label class="trk-set-field"><span>' + field.label + '</span>' +
                        '<input class="trk-search" type="text" data-field="' + field.id + '" placeholder="' +
                        field.hint + '" value="' + escapeHtml(state.csvColumns[field.id] || '') + '"></label>';
                }).join('') + '</div></section></div>';
    }

    function wire() {
        els.body.addEventListener('change', function (event) {
            if (event.target.dataset.cat !== undefined) {
                TrackerStore.setCategoryKind(event.target.dataset.cat, event.target.value);
                FireApp.toast('Category updated');
            } else if (event.target.dataset.field !== undefined) {
                TrackerStore.setCsvColumn(event.target.dataset.field, event.target.value);
                FireApp.toast('Import mapping saved');
            }
        });
        els.body.addEventListener('click', function (event) {
            if (event.target.dataset.act !== 'addCat') return;
            var name = els.body.querySelector('[data-el="newCat"]');
            var kind = els.body.querySelector('[data-el="newKind"]');
            if (!name.value.trim()) {
                FireApp.toast('Name the category first');
                return;
            }
            TrackerStore.setCategoryKind(name.value, kind.value);
            FireApp.toast('Category type set');
        });
    }

    function escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function unmount() {
        pendingUpdate = false;
        els = {};
    }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'categories', name: 'Categories', tag: 'Transaction types and CSV columns',
        mount: mount, update: update, unmount: unmount
    });

})(window);
