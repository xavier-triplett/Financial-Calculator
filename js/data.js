/* FireData — portable, local-first backups for the complete workspace. */
(function (global) {
    'use strict';

    var EXPORT_VERSION = 1;
    var MAX_IMPORT_BYTES = 25 * 1024 * 1024;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function snapshot() {
        return {
            meridianExport: EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            plan: clone(global.FireStore.get()),
            tracker: clone(global.TrackerStore.get())
        };
    }

    function validEnvelope(value) {
        return !!value && typeof value === 'object' &&
            value.meridianExport === EXPORT_VERSION &&
            value.plan && typeof value.plan === 'object' &&
            value.plan.inputs && Array.isArray(value.plan.phases) &&
            value.tracker && typeof value.tracker === 'object' &&
            Array.isArray(value.tracker.accounts) && Array.isArray(value.tracker.txns);
    }

    function parse(value) {
        var parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!validEnvelope(parsed)) {
            throw new Error('This is not a supported Meridian backup.');
        }
        return parsed;
    }

    function restore(value) {
        var parsed = parse(value);
        global.FireStore.replace(parsed.plan);
        global.TrackerStore.replace(parsed.tracker);
        return true;
    }

    function filename() {
        return 'meridian-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    }

    function download() {
        var blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename();
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function readFile(file) {
        if (!file) return Promise.reject(new Error('Choose a backup file first.'));
        if (file.size > MAX_IMPORT_BYTES) {
            return Promise.reject(new Error('Backups must be 25 MB or smaller.'));
        }
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                try { resolve(parse(reader.result)); }
                catch (error) { reject(error); }
            };
            reader.onerror = function () { reject(new Error('The backup could not be read.')); };
            reader.readAsText(file);
        });
    }

    global.FireData = {
        EXPORT_VERSION: EXPORT_VERSION,
        snapshot: snapshot,
        restore: restore,
        readFile: readFile,
        download: download,
        filename: filename
    };

})(typeof window !== 'undefined' ? window : globalThis);
