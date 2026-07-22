/* FireCloud — optional Google sign-in + Firestore sync for the plan and the
 * tracker. Entirely guarded: if the Firebase SDK or its config is absent
 * (offline, blocked network, or no firebase-config.js), FireCloud.available()
 * is false and the app runs exactly as before on localStorage alone.
 *
 * Model: one document per user at /users/{uid} holding the whole app state.
 *   - Sign in → pull that doc. If it exists, the account is the source of
 *     truth and its data is adopted. If not, the current (local) data seeds it.
 *   - While signed in, every store change is debounced and pushed up.
 * localStorage stays the offline cache underneath, always. */
(function (global) {
    'use strict';

    var SCHEMA_VERSION = 1;
    var PUSH_DEBOUNCE = 1500;

    var fb = global.firebase;
    var config = global.FirebaseConfig;
    var available = !!(fb && config && config.apiKey);

    var auth = null, db = null;
    var currentUser = null;
    var authListeners = [];
    var adopting = false;   // suppress write-back while adopting a pulled doc
    var pulling = false;    // suppress pushes until the sign-in pull settles
    var pushTimer = null;
    var wired = false;

    function toast(msg) { if (global.FireApp && FireApp.toast) FireApp.toast(msg); }
    function notifyAuth() { authListeners.forEach(function (fn) { fn(currentUser); }); }
    function docRef() { return db.collection('users').doc(currentUser.uid); }

    /* Whole-app state as a plain, Firestore-safe object (JSON round-trip drops
     * undefined values and any stray functions). */
    function snapshot() {
        return JSON.parse(JSON.stringify({
            version: SCHEMA_VERSION,
            plan: FireStore.get(),
            tracker: TrackerStore.get()
        }));
    }

    function adopt(data) {
        adopting = true;
        try {
            FireStore.replace(data && data.plan);
            TrackerStore.replace(data && data.tracker);
        } finally {
            adopting = false;
        }
    }

    function schedulePush() {
        if (!currentUser || adopting || pulling) return;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE);
    }

    function pushNow() {
        if (!currentUser) return;
        var payload = snapshot();
        payload.updatedAt = fb.firestore.FieldValue.serverTimestamp();
        docRef().set(payload).catch(function (e) { console.warn('[FireCloud] push failed', e); });
    }

    function onSignIn(user) {
        currentUser = user;
        pulling = true; // a push before the pull settles could clobber the account doc
        notifyAuth(); // reflect the signed-in identity immediately
        docRef().get().then(function (snap) {
            if (currentUser !== user) return; // signed out or switched mid-pull
            var data = snap.exists ? snap.data() : null;
            if (data && data.plan) {
                pulling = false;
                adopt(data);
                toast('Signed in — your saved data loaded');
                return;
            }
            var seed = function () {
                pulling = false;
                pushNow();
                toast('Signed in — this device’s data is now saved to your account');
            };
            // A fresh account inherits this device's data only with consent,
            // so a shared machine's leftovers never leak into a new account.
            var hasLocal = !FireStore.isDefault() || !TrackerStore.isEmpty();
            if (hasLocal && global.FireApp && FireApp.confirm) {
                // strict: only the explicit Cancel button declines (and signs
                // out); a stray backdrop click or Escape must not.
                FireApp.confirm('This device already holds data. Save it to this new account?', seed, 'Save it', {
                    strict: true,
                    onCancel: function () {
                        toast('Nothing was saved — clear this device’s data first for a blank account');
                        auth.signOut();
                    }
                });
            } else {
                seed();
            }
        }).catch(function (e) {
            if (currentUser !== user) return;
            pulling = false;
            console.warn('[FireCloud] pull failed', e);
            toast('Signed in, but loading your data failed — working locally');
        });
    }

    function onSignOut() {
        currentUser = null;
        pulling = false;
        clearTimeout(pushTimer);
        notifyAuth();
    }

    function wireStores() {
        if (wired) return;
        wired = true;
        FireStore.subscribe(schedulePush);
        TrackerStore.subscribe(schedulePush);
    }

    global.FireCloud = {
        available: function () { return available; },
        signedIn: function () { return !!currentUser; },
        user: function () { return currentUser; },
        onChange: function (fn) {
            authListeners.push(fn);
            return function () {
                var i = authListeners.indexOf(fn);
                if (i >= 0) authListeners.splice(i, 1);
            };
        },

        init: function () {
            if (!available) return;
            fb.initializeApp(config);
            auth = fb.auth();
            db = fb.firestore();
            wireStores();
            auth.onAuthStateChanged(function (user) {
                if (user) onSignIn(user);
                else onSignOut();
            });
        },

        signIn: function () {
            if (!available) return;
            var provider = new fb.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(function (e) {
                if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
                    auth.signInWithRedirect(provider);
                } else if (e && e.code !== 'auth/cancelled-popup-request' && e.code !== 'auth/popup-closed-by-user') {
                    console.warn('[FireCloud] sign-in failed', e);
                    toast('Sign-in failed: ' + ((e && e.message) || e));
                }
            });
        },

        signOut: function () { if (available && auth) auth.signOut(); }
    };

})(typeof window !== 'undefined' ? window : globalThis);
