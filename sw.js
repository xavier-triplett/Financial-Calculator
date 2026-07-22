var CACHE = 'coast-ledger-2026-07-22-paths';
var ASSETS = [
    './',
    './index.html',
    './favicon.svg',
    './css/fonts.css',
    './css/base.css',
    './css/flatpickr.min.css',
    './css/flatpickr-theme.css',
    './css/profile.css',
    './css/ledger.css',
    './css/tracker.css',
    './css/guide.css',
    './css/fonts/fraunces.woff2',
    './css/fonts/fraunces-italic.woff2',
    './css/fonts/ibm-plex-mono-400.woff2',
    './css/fonts/ibm-plex-mono-500.woff2',
    './css/fonts/ibm-plex-mono-600.woff2',
    './css/fonts/ibm-plex-mono-700.woff2',
    './css/fonts/public-sans.woff2',
    './js/engine.js',
    './js/security.js',
    './js/util.js',
    './js/schema.js',
    './js/store.js',
    './js/forms.js',
    './js/firebase-config.js',
    './js/firebase-loader.js',
    './js/cloud.js',
    './js/tracker/engine.js',
    './js/tracker/rocketmoney.js',
    './js/tracker/store.js',
    './js/tracker/kit.js',
    './js/ui/profile.js',
    './js/ui/ledger.js',
    './js/ui/tracker-observatory.js',
    './js/ui/tracker-cashbook.js',
    './js/ui/tracker-settings.js',
    './js/ui/guide.js',
    './js/app.js',
    './js/vendor/chart.umd.min.js',
    './js/vendor/flatpickr.min.js'
];

self.addEventListener('install', function (event) {
    event.waitUntil(caches.open(CACHE).then(function (cache) {
        return cache.addAll(ASSETS);
    }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
    event.waitUntil(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (key) {
            return key.indexOf('coast-ledger-') === 0 && key !== CACHE;
        }).map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
    event.respondWith(fetch(event.request).then(function (response) {
        if (response.ok) {
            var copy = response.clone();
            event.waitUntil(caches.open(CACHE).then(function (cache) {
                return cache.put(event.request, copy);
            }));
        }
        return response;
    }).catch(function (error) {
        return caches.match(event.request).then(function (cached) {
            if (cached) return cached;
            if (event.request.mode !== 'navigate') throw error;
            return caches.match('./index.html').then(function (fallback) {
                if (fallback) return fallback;
                throw error;
            });
        });
    }));
});
