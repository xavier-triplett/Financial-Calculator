(function (global) {
    'use strict';

    var FILES = [
        ['vendor/firebase-app-compat.js', function () {
            return global.firebase && typeof global.firebase.initializeApp === 'function';
        }],
        ['vendor/firebase-auth-compat.js', function () {
            return global.firebase && typeof global.firebase.auth === 'function' &&
                typeof global.firebase.auth.GoogleAuthProvider === 'function';
        }],
        ['vendor/firebase-firestore-compat.js', function () {
            return global.firebase && typeof global.firebase.firestore === 'function' &&
                global.firebase.firestore.FieldValue &&
                typeof global.firebase.firestore.FieldValue.serverTimestamp === 'function';
        }]
    ];

    var loadPromise = null;
    var preloadPromise = null;
    var preloadStart = null;
    var preloadCancel = null;
    var baseUrl = scriptBase();

    function scriptBase() {
        if (!global.document) return '';
        var script = global.document.currentScript;
        if (!script || !script.src) {
            var scripts = global.document.getElementsByTagName('script');
            for (var i = scripts.length - 1; i >= 0; i--) {
                if (/\/firebase-loader\.js(?:[?#].*)?$/.test(scripts[i].src || '')) {
                    script = scripts[i];
                    break;
                }
            }
        }
        if (!script || !script.src) return '';
        return script.src.slice(0, script.src.lastIndexOf('/') + 1);
    }

    function ready() {
        return FILES.every(function (entry) { return entry[1](); });
    }

    function inject(relativePath) {
        return new Promise(function (resolve, reject) {
            if (!global.document || !baseUrl) {
                reject(new Error('Firebase SDK loader needs a browser document'));
                return;
            }
            var src = new URL(relativePath, baseUrl).href;
            var existing = Array.prototype.filter.call(
                global.document.getElementsByTagName('script'),
                function (node) { return node.src === src; }
            )[0];
            var script = existing || global.document.createElement('script');
            var done = function () {
                if (script.dataset) script.dataset.fireLoaded = 'true';
                resolve();
            };
            var failed = function () {
                if (script.dataset && script.dataset.fireFirebaseSdk === 'true' && script.parentNode) {
                    script.parentNode.removeChild(script);
                }
                reject(new Error('Could not load ' + relativePath));
            };

            if (existing && ((existing.dataset && existing.dataset.fireLoaded === 'true') ||
                existing.readyState === 'complete')) {
                resolve();
                return;
            }
            script.addEventListener('load', done, { once: true });
            script.addEventListener('error', failed, { once: true });
            if (!existing) {
                script.src = src;
                script.async = false;
                script.dataset.fireFirebaseSdk = 'true';
                (global.document.head || global.document.documentElement).appendChild(script);
            }
        });
    }

    function load() {
        if (preloadStart) {
            var start = preloadStart;
            preloadStart = null;
            start();
            return loadPromise;
        }
        if (ready()) return Promise.resolve(global.firebase);
        if (loadPromise) return loadPromise;
        loadPromise = FILES.reduce(function (promise, entry) {
            return promise.then(function () {
                return entry[1]() ? null : inject(entry[0]);
            });
        }, Promise.resolve()).then(function () {
            if (!ready()) throw new Error('Firebase SDK loaded incompletely');
            return global.firebase;
        }).catch(function (error) {
            loadPromise = null;
            throw error;
        });
        return loadPromise;
    }

    function preload() {
        if (ready()) return Promise.resolve(global.firebase);
        if (preloadPromise) return preloadPromise;
        preloadPromise = new Promise(function (resolve, reject) {
            preloadStart = function () {
                if (preloadCancel) preloadCancel();
                preloadCancel = null;
                preloadStart = null;
                load().then(resolve, reject);
            };
            if (typeof global.requestIdleCallback === 'function') {
                var idleId = global.requestIdleCallback(preloadStart, { timeout: 2000 });
                preloadCancel = function () {
                    if (typeof global.cancelIdleCallback === 'function') global.cancelIdleCallback(idleId);
                };
            } else {
                var timerId = global.setTimeout(preloadStart, 50);
                preloadCancel = function () { global.clearTimeout(timerId); };
            }
        }).catch(function (error) {
            preloadPromise = null;
            preloadStart = null;
            preloadCancel = null;
            throw error;
        });
        return preloadPromise;
    }

    global.FirebaseLoader = {
        available: function () {
            return !!(global.FirebaseConfig && global.FirebaseConfig.apiKey &&
                (ready() || (global.document && baseUrl)));
        },
        ready: ready,
        load: load,
        preload: preload
    };
})(typeof window !== 'undefined' ? window : globalThis);
