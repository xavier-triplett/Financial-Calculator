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
        return '' +
        '<div class="trk-shell">' +
            '<header class="trk-masthead">' +
                '<div>' +
                    '<span class="trk-eyebrow">Cashbook configuration</span>' +
                    '<h1>Rules &amp; categories</h1>' +
                    '<span class="trk-sub">Teach imports once, then keep spending categories consistent</span>' +
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
        for (var kind in E.KIND) E.KIND[kind].forEach(function (c) { add(c, false); });
        state.txns.forEach(function (t) { add(t.category, false); });
        Object.keys(state.categoryKinds).forEach(function (c) { add(c, true); });
        return Object.keys(byFold).map(function (key) { return byFold[key]; }).sort(function (a, b) {
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
        var customByFold = {};
        Object.keys(state.categoryKinds).forEach(function (cat) { customByFold[cat.toLowerCase()] = true; });
        return knownCategories(state).map(function (cat) {
            var kind = E.categoryKind(cat);
            var custom = !!customByFold[cat.toLowerCase()];
            return '<tr>' +
                '<td>' + escapeHtml(cat) + (custom ? ' <em class="trk-est">custom</em>' : '') + '</td>' +
                '<td><span class="trk-badge trk-badge-' + kind + '">' + KIND_LABELS[kind] + '</span></td>' +
                '<td><select class="trk-select" aria-label="Classification for ' + escapeHtml(cat) + '" data-cat="' + escapeHtml(cat) + '">' + kindOptions(cat, kind) + '</select></td>' +
            '</tr>';
        }).join('');
    }

    function merchantRules(state) {
        var rules = state.merchantRules || [];
        var accountOptions = '<option value="">Any account</option>' + state.accounts.map(function (account) {
            return '<option value="' + escapeHtml(account.id) + '">' + escapeHtml(account.name) + '</option>';
        }).join('');
        var rows = rules.map(function (rule) {
            return '<tr><td>' + escapeHtml(rule.match) + '</td><td>' + escapeHtml(rule.mode) + '</td>' +
                '<td>' + escapeHtml(rule.category) + '</td><td>' + escapeHtml((state.accounts.filter(function (account) {
                    return account.id === rule.accountId;
                })[0] || {}).name || 'Any') + '</td>' +
                '<td><label class="trk-rule-toggle"><input type="checkbox" data-rule-enabled="' + escapeHtml(rule.id) + '"' +
                    (rule.enabled ? ' checked' : '') + '> Active</label></td>' +
                '<td><button class="trk-x trk-x-visible" type="button" data-rule-delete="' + escapeHtml(rule.id) + '" aria-label="Delete merchant rule">×</button></td></tr>';
        }).join('');
        return '<section class="trk-panel trk-set-rules">' +
            '<div class="trk-panel-head"><h2>Merchant rules</h2><span class="trk-panel-note">applied to future CSV imports</span></div>' +
            '<p class="trk-set-blurb">A rule says, for example, “names containing SAFEWAY count as Groceries.” ' +
                'Higher-priority rules win when more than one matches.</p>' +
            (rows ? '<div class="trk-regwrap"><table class="trk-register"><caption class="trk-sr-only">Merchant categorization rules</caption>' +
                '<thead><tr><th>Merchant text</th><th>Match</th><th>Category</th><th>Account</th><th>Status</th><th></th></tr></thead>' +
                '<tbody>' + rows + '</tbody></table></div>' : '<p class="trk-kpi-note">No merchant rules yet.</p>') +
            '<div class="trk-rule-add">' +
                '<input class="trk-search" data-rule-new="match" placeholder="Merchant text" aria-label="Merchant text to match">' +
                '<select class="trk-select" data-rule-new="mode" aria-label="Merchant match type">' +
                    '<option value="contains">Contains</option><option value="startsWith">Starts with</option><option value="equals">Exactly equals</option></select>' +
                '<input class="trk-search" data-rule-new="category" placeholder="Category" aria-label="Category to assign">' +
                '<select class="trk-select" data-rule-new="accountId" aria-label="Limit rule to account">' + accountOptions + '</select>' +
                '<button class="trk-btn trk-btn-primary" type="button" data-act="addRule">Add rule</button>' +
            '</div></section>';
    }

    function update(state) {
        // Don't rebuild under a focused text field (add-category / CSV headers)
        var a = document.activeElement;
        if (a && a.tagName === 'INPUT' && els.root.contains(a)) {
            pendingUpdate = true;
            return;
        }
        pendingUpdate = false;

        els.body.innerHTML =
            '<div class="trk-set-cols">' +
                '<section class="trk-panel">' +
                    '<div class="trk-panel-head"><h2>Category kinds</h2>' +
                        '<span class="trk-panel-note">how each category counts in the statement</span></div>' +
                    '<p class="trk-set-blurb">Income adds, expenses subtract, and transfers are excluded so money moving ' +
                        'between your own accounts never reads as spending. Savings contributions count as money deliberately ' +
                        'set aside &mdash; the observed savings rate uses them instead of assuming the whole surplus was saved. ' +
                        'Unlisted categories count as discretionary spending; override any category here.</p>' +
                    '<div class="trk-cat-add">' +
                        '<label class="trk-cat-field"><span>Category name</span>' +
                            '<input class="trk-search" type="text" placeholder="e.g. Childcare" data-el="newCat"></label>' +
                        '<label class="trk-cat-field"><span>Counts as</span>' +
                            '<select class="trk-select" data-el="newKind">' + kindOptions('', 'spending') + '</select></label>' +
                        '<button class="trk-btn trk-btn-primary" type="button" data-act="addCat">Set kind</button>' +
                    '</div>' +
                    '<div class="trk-regwrap"><table class="trk-register">' +
                        '<caption class="trk-sr-only">Category classification rules</caption>' +
                        '<thead><tr><th scope="col">Category</th><th scope="col">Counts as</th><th scope="col">Change</th></tr></thead>' +
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
            '</div>' +
            merchantRules(state);
    }

    function wire() {
        els.body.addEventListener('change', function (e) {
            if (e.target.dataset.cat !== undefined) {
                TrackerStore.setCategoryKind(e.target.dataset.cat, e.target.value);
                FireApp.toast('Category updated');
            } else if (e.target.dataset.field !== undefined) {
                TrackerStore.setCsvColumn(e.target.dataset.field, e.target.value);
                FireApp.toast('Import mapping saved');
            } else if (e.target.dataset.ruleEnabled) {
                TrackerStore.updateMerchantRule(e.target.dataset.ruleEnabled, { enabled: e.target.checked });
                FireApp.toast('Rule updated');
            }
        });
        els.body.addEventListener('click', function (e) {
            if (e.target.dataset.act === 'addCat') {
                var name = els.body.querySelector('[data-el="newCat"]');
                var kind = els.body.querySelector('[data-el="newKind"]');
                if (!name.value.trim()) { FireApp.toast('Name the category first'); return; }
                TrackerStore.setCategoryKind(name.value, kind.value);
                FireApp.toast('Category kind set');
            } else if (e.target.dataset.act === 'addRule') {
                var fields = {};
                els.body.querySelectorAll('[data-rule-new]').forEach(function (input) {
                    fields[input.dataset.ruleNew] = input.value;
                });
                var rule = TrackerStore.addMerchantRule(fields);
                FireApp.toast(rule ? 'Merchant rule added' : 'Add merchant text and a category');
            } else if (e.target.dataset.ruleDelete) {
                FireApp.confirm('Delete this merchant rule?', function () {
                    TrackerStore.removeMerchantRule(e.target.dataset.ruleDelete);
                });
            }
        });
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function unmount() { pendingUpdate = false; els = {}; }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'categories', name: 'Rules', tag: 'Merchant rules, categories, and CSV columns',
        mount: mount, update: update, unmount: unmount
    });

})(window);
