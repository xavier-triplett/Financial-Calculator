/* UI: CATEGORIES — configuration for the Cashbook's bookkeeping rules.
 * Two concerns live here: which kind each category counts as (income /
 * transfer / fixed / variable / spending), and which CSV headers the
 * importer reads when an export doesn't use Rocket Money's column names. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var E = global.TrackerEngine;
    var K = global.TrackerKit;
    var els = {};

    var KIND_LABELS = {
        income: 'Income',
        transfer: 'Transfer (excluded)',
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
        return '' +
        '<div class="trk-shell">' +
            '<header class="trk-masthead">' +
                '<div>' +
                    '<span class="trk-eyebrow">Cashbook configuration</span>' +
                    '<h1>Categories</h1>' +
                    '<span class="trk-sub">How transactions are classified, and how CSV imports are read</span>' +
                '</div>' +
                '<div class="trk-mast-actions" data-el="actions"></div>' +
            '</header>' +
            '<div data-el="body"></div>' +
        '</div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = { root: root, body: root.querySelector('[data-el="body"]'), actions: root.querySelector('[data-el="actions"]') };
        els.actions.appendChild(K.templateButton());
        wire();
    }

    function knownCategories(state) {
        var set = {};
        for (var kind in E.KIND) E.KIND[kind].forEach(function (c) { set[c] = true; });
        state.txns.forEach(function (t) { if (t.category) set[t.category] = true; });
        Object.keys(state.categoryKinds).forEach(function (c) { set[c] = true; });
        return Object.keys(set).sort(function (a, b) {
            return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
        });
    }

    function kindOptions(cat, selected) {
        return E.KINDS.map(function (kind) {
            var label = KIND_LABELS[kind] + (kind === E.defaultKind(cat) ? ' — default' : '');
            return '<option value="' + kind + '"' + (kind === selected ? ' selected' : '') + '>' + label + '</option>';
        }).join('');
    }

    function catRows(state) {
        return knownCategories(state).map(function (cat) {
            var kind = E.categoryKind(cat);
            var custom = Object.prototype.hasOwnProperty.call(state.categoryKinds, cat);
            return '<tr>' +
                '<td>' + escapeHtml(cat) + (custom ? ' <em class="trk-est">custom</em>' : '') + '</td>' +
                '<td><span class="trk-badge trk-badge-' + kind + '">' + KIND_LABELS[kind] + '</span></td>' +
                '<td><select class="trk-select" data-cat="' + escapeHtml(cat) + '">' + kindOptions(cat, kind) + '</select></td>' +
            '</tr>';
        }).join('');
    }

    function update(state) {
        // Don't rebuild under a focused text field (add-category / CSV headers)
        var a = document.activeElement;
        if (a && a.tagName === 'INPUT' && els.root.contains(a)) return;

        els.body.innerHTML =
            '<div class="trk-set-cols">' +
                '<section class="trk-panel">' +
                    '<div class="trk-panel-head"><h2>Category kinds</h2>' +
                        '<span class="trk-panel-note">how each category counts in the statement</span></div>' +
                    '<p class="trk-set-blurb">Income adds, expenses subtract, and transfers are excluded so money moving ' +
                        'between your own accounts never reads as spending. Unlisted categories count as discretionary ' +
                        'spending; override any category here.</p>' +
                    '<div class="trk-cat-add">' +
                        '<input class="trk-search" type="text" placeholder="Category name" data-el="newCat">' +
                        '<select class="trk-select" data-el="newKind">' + kindOptions('', 'spending') + '</select>' +
                        '<button class="trk-btn trk-btn-primary" type="button" data-act="addCat">Set kind</button>' +
                    '</div>' +
                    '<div class="trk-regwrap"><table class="trk-register">' +
                        '<thead><tr><th>Category</th><th>Counts as</th><th>Change</th></tr></thead>' +
                        '<tbody>' + catRows(state) + '</tbody>' +
                    '</table></div>' +
                '</section>' +
                '<section class="trk-panel">' +
                    '<div class="trk-panel-head"><h2>CSV import columns</h2>' +
                        '<span class="trk-panel-note">for non&#8209;Rocket&#8209;Money exports</span></div>' +
                    '<p class="trk-set-blurb">The importer looks for Rocket Money&rsquo;s column headers. If your bank&rsquo;s ' +
                        'export names them differently, point each field at your header here (leave blank to use the ' +
                        'defaults, shown greyed). Extra columns are ignored, and the template download shows the expected shape.</p>' +
                    '<div class="trk-set-fields">' + CSV_FIELDS.map(function (f) {
                        return '<label class="trk-set-field"><span>' + f.label + '</span>' +
                            '<input class="trk-search" type="text" data-field="' + f.id + '" placeholder="' + f.hint + '" value="' +
                            escapeHtml(state.csvColumns[f.id] || '') + '"></label>';
                    }).join('') + '</div>' +
                '</section>' +
            '</div>';
    }

    function wire() {
        els.body.addEventListener('change', function (e) {
            if (e.target.dataset.cat !== undefined) {
                TrackerStore.setCategoryKind(e.target.dataset.cat, e.target.value);
                FireApp.toast('Category updated');
            } else if (e.target.dataset.field !== undefined) {
                TrackerStore.setCsvColumn(e.target.dataset.field, e.target.value);
                FireApp.toast('Import mapping saved');
            }
        });
        els.body.addEventListener('click', function (e) {
            if (e.target.dataset.act !== 'addCat') return;
            var name = els.body.querySelector('[data-el="newCat"]');
            var kind = els.body.querySelector('[data-el="newKind"]');
            if (!name.value.trim()) { FireApp.toast('Name the category first'); return; }
            // The store commit re-renders the tab, which also resets this row
            TrackerStore.setCategoryKind(name.value, kind.value);
            FireApp.toast('Category kind set');
        });
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function unmount() { els = {}; }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'categories', name: 'Categories', tag: 'Bookkeeping rules & CSV import',
        mount: mount, update: update, unmount: unmount
    });

})(window);
