/* UI: DATA — backup, restore, freshness, undo, and deletion controls. */
(function (global) {
    'use strict';

    var U = global.FireUtil;
    var els = {};

    function escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function readableTime(value) {
        if (!value) return 'Not recorded';
        var date = new Date(value);
        if (isNaN(date.getTime())) return 'Not recorded';
        return date.toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
        });
    }

    function template() {
        return '<div class="trk-shell data-shell">' +
            '<header class="trk-masthead">' +
                '<div><span class="trk-eyebrow">Ownership &amp; safety</span>' +
                    '<h1>Your data</h1>' +
                    '<span class="trk-sub">Portable backups, undo history, freshness, and deletion</span></div>' +
                '<div class="trk-mast-actions">' +
                    '<button class="trk-btn trk-btn-primary" type="button" data-act="export">Download backup</button>' +
                    '<button class="trk-btn" type="button" data-act="restore">Restore backup</button>' +
                    '<input type="file" accept=".json,application/json" data-el="file" hidden>' +
                '</div>' +
            '</header>' +
            '<div data-el="body"></div>' +
        '</div>';
    }

    function mount(root) {
        root.innerHTML = template();
        els = {
            root: root,
            body: root.querySelector('[data-el="body"]'),
            file: root.querySelector('[data-el="file"]')
        };
        root.addEventListener('click', onClick);
        els.file.addEventListener('change', onFile);
    }

    function accountFreshness(state) {
        if (!state.accounts.length) {
            return '<p class="trk-kpi-note">Add an account in Net Worth to begin tracking source dates.</p>';
        }
        var derived = global.TrackerEngine && typeof TrackerEngine.dataFreshness === 'function'
            ? TrackerEngine.dataFreshness(state).accounts : [];
        var derivedById = {};
        derived.forEach(function (item) { derivedById[item.id] = item; });
        var rows = state.accounts.map(function (account) {
            var freshness = account.freshness || {};
            var resolved = derivedById[account.id] || {};
            var asOf = resolved.asOf || freshness.asOf || freshness.updatedAt;
            var sourceValue = resolved.source || freshness.source;
            var source = sourceValue === 'import' ? 'Imported' :
                sourceValue === 'sync' ? 'Connected' : 'Manual';
            return '<tr><td>' + escapeHtml(account.name) + '</td>' +
                '<td>' + escapeHtml(account.institution || '—') + '</td>' +
                '<td><span class="trk-badge">' + source + (resolved.status === 'stale' ? ' · stale' : '') + '</span></td>' +
                '<td class="num">' + (asOf ? escapeHtml(readableTime(asOf)) : 'No balance date') + '</td></tr>';
        }).join('');
        return '<div class="trk-regwrap"><table class="trk-register">' +
            '<caption class="trk-sr-only">Account data freshness</caption>' +
            '<thead><tr><th scope="col">Account</th><th scope="col">Institution</th>' +
                '<th scope="col">Source</th><th class="num" scope="col">Balance as of</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table></div>';
    }

    function update(state) {
        var cloud = global.FireCloud && FireCloud.user && FireCloud.user();
        var status = cloud ? FireCloud.status() : null;
        var trackerMeta = typeof TrackerStore.metadata === 'function' ? TrackerStore.metadata() : state.meta;
        var planUpdated = typeof FireStore.updatedAt === 'function' ? FireStore.updatedAt() :
            (FireStore.get().meta && FireStore.get().meta.updatedAt);
        var trackerUpdated = trackerMeta && trackerMeta.updatedAt;
        var planUndo = FireStore.canUndo && FireStore.canUndo();
        var trackerUndo = TrackerStore.canUndo && TrackerStore.canUndo();
        var cloudText = cloud
            ? 'Signed in as ' + escapeHtml(cloud.email || cloud.displayName || 'your Google account') +
                '. Sync status: ' + escapeHtml(status && status.phase || 'connecting') + '.'
            : 'No account is connected. Your workspace stays in this browser unless you download a backup.';

        els.body.innerHTML =
            '<div class="data-grid">' +
                '<section class="trk-panel data-lead">' +
                    '<div class="trk-panel-head"><h2>Local-first by default</h2>' +
                        '<span class="trk-panel-note">plain-language data policy</span></div>' +
                    '<p class="data-copy">The planner works without an account. A downloaded backup contains your full plan, ' +
                        'balances, transactions, budgets, and goals as readable JSON. It is not encrypted, so keep it somewhere private.</p>' +
                    '<div class="data-status"><span><strong>Plan updated</strong>' + readableTime(planUpdated) + '</span>' +
                        '<span><strong>Tracker updated</strong>' + readableTime(trackerUpdated) + '</span></div>' +
                    '<p class="data-cloud">' + cloudText + '</p>' +
                '</section>' +
                '<section class="trk-panel">' +
                    '<div class="trk-panel-head"><h2>Undo recent changes</h2>' +
                        '<span class="trk-panel-note">up to ' + (TrackerStore.UNDO_LIMIT || 25) + ' tracker edits</span></div>' +
                    '<p class="data-copy">Undo is kept only for this browser session. Backups are the durable safety net.</p>' +
                    '<div class="data-actions">' +
                        '<button class="trk-btn" type="button" data-act="undo-plan"' + (planUndo ? '' : ' disabled') + '>Undo plan change</button>' +
                        '<button class="trk-btn" type="button" data-act="undo-tracker"' + (trackerUndo ? '' : ' disabled') + '>Undo tracker change' +
                            (TrackerStore.undoDepth ? ' (' + TrackerStore.undoDepth() + ')' : '') + '</button>' +
                    '</div>' +
                '</section>' +
                '<section class="trk-panel data-wide">' +
                    '<div class="trk-panel-head"><h2>Account freshness</h2>' +
                        '<span class="trk-panel-note">know how current every balance is</span></div>' +
                    accountFreshness(state) +
                '</section>' +
                '<section class="trk-panel data-danger data-wide">' +
                    '<div class="trk-panel-head"><h2>Delete workspace</h2>' +
                        '<span class="trk-panel-note">permanent after this session&rsquo;s undo is gone</span></div>' +
                    '<p class="data-copy">' + (cloud
                        ? 'Deletes the synced plan and tracker from your account and clears this browser. New edits made while signed in can create a fresh cloud workspace.'
                        : 'Clears the plan and tracker from this browser. Download a backup first if you may want the data later.') + '</p>' +
                    '<button class="trk-btn trk-btn-danger" type="button" data-act="delete-all">' +
                        (cloud ? 'Delete cloud + local data' : 'Clear local data') + '</button>' +
                '</section>' +
            '</div>';
    }

    function onFile() {
        var file = els.file.files && els.file.files[0];
        if (!file) return;
        FireData.readFile(file).then(function (snapshot) {
            FireApp.confirm(
                'Restore this backup from ' + readableTime(snapshot.exportedAt) + '? It replaces the current plan and tracker.',
                function () {
                    try {
                        FireData.restore(snapshot);
                        FireApp.toast('Backup restored');
                    } catch (error) {
                        FireApp.toast(error.message || 'Backup could not be restored');
                    }
                },
                'Restore backup'
            );
        }).catch(function (error) {
            FireApp.toast(error.message || 'Backup could not be read');
        });
        els.file.value = '';
    }

    function deleteWorkspace() {
        var cloud = global.FireCloud && FireCloud.user && FireCloud.user();
        FireApp.confirm(
            cloud
                ? 'Permanently delete the synced plan, tracker, and this browser’s copy? Download a backup first if you may need it.'
                : 'Clear the complete plan and tracker from this browser?',
            function () {
                if (cloud && typeof FireCloud.deleteAllData === 'function') {
                    FireCloud.deleteAllData().then(function (deleted) {
                        if (deleted) FireApp.toast('Cloud and local data deleted');
                    });
                } else {
                    FireStore.reset();
                    TrackerStore.reset();
                    FireApp.toast('Local data cleared');
                }
            },
            cloud ? 'Delete everywhere' : 'Clear data'
        );
    }

    function onClick(event) {
        var button = event.target.closest('[data-act]');
        if (!button) return;
        var action = button.dataset.act;
        if (action === 'export') {
            FireData.download();
            FireApp.toast('Backup downloaded');
        } else if (action === 'restore') {
            els.file.click();
        } else if (action === 'undo-plan' && FireStore.undo()) {
            FireApp.toast('Plan change undone');
        } else if (action === 'undo-tracker' && TrackerStore.undo()) {
            FireApp.toast('Tracker change undone');
        } else if (action === 'delete-all') {
            deleteWorkspace();
        }
    }

    function unmount() { els = {}; }

    (global.TrackerUIs = global.TrackerUIs || []).push({
        id: 'data', name: 'Data', tag: 'Backup, undo, freshness, and deletion',
        mount: mount, update: update, unmount: unmount
    });

})(window);
