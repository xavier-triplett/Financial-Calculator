(function (global) {
    'use strict';

    var SCHEMA_VERSION = 2;
    var LEGACY_SCHEMA_VERSION = 1;
    var PUSH_DEBOUNCE = 750;
    var CHUNK_SIZE = 700000;
    var MAX_CHUNKS = 9;
    var SYNC_PREFIX = 'fireCloudSync_v2:';
    var OWNER_KEY = 'fireCloudOwner_v2';
    var LOCAL_PREFIX = 'fireCloudLocal_v2:';
    var ANON_LOCAL_KEY = 'fireCloudLocal_v2:anonymous';

    var auth = null;
    var db = null;
    var currentUser = null;
    var authListeners = [];
    var statusListeners = [];
    var wired = false;
    var applying = false;
    var initialized = false;
    var initPromise = null;
    var hydrationPromise = null;
    var flushPromise = null;
    var pushTimer = null;
    var retryTimer = null;
    var retryAction = null;
    var retryDelay = 1000;
    var retryAt = null;
    var generation = 0;
    var record = null;
    var pendingSeedCandidate = null;
    var domains = freshDomains();
    var state = { phase: 'idle', error: null };

    function freshDomain() {
        return {
            hydrated: false,
            dirty: false,
            sessionDirty: false,
            baseRevision: 0,
            lastHash: null,
            conflict: null
        };
    }

    function freshDomains() {
        return { plan: freshDomain(), tracker: freshDomain() };
    }

    function toast(message) {
        if (global.FireApp && typeof global.FireApp.toast === 'function') {
            global.FireApp.toast(message);
        }
    }

    function errorText(error) {
        return error ? String(error.message || error) : null;
    }

    function retryable(error) {
        var code = String(error && error.code || '').replace(/^firestore\//, '');
        return ['aborted', 'deadline-exceeded', 'internal', 'unavailable', 'unknown'].indexOf(code) >= 0;
    }

    function sdkReady() {
        var fb = global.firebase;
        return !!(fb && typeof fb.initializeApp === 'function' &&
            typeof fb.auth === 'function' && typeof fb.auth.GoogleAuthProvider === 'function' &&
            typeof fb.firestore === 'function' && fb.firestore.FieldValue &&
            typeof fb.firestore.FieldValue.serverTimestamp === 'function');
    }

    function available() {
        var config = global.FirebaseConfig;
        if (!config || !config.apiKey || !config.projectId) return false;
        return sdkReady() || !!(global.FirebaseLoader && global.FirebaseLoader.available());
    }

    function statusSnapshot() {
        var pending = Object.keys(domains).filter(function (name) { return domains[name].dirty; });
        var conflicts = {};
        Object.keys(domains).forEach(function (name) {
            var conflict = domains[name].conflict;
            if (conflict) {
                conflicts[name] = {
                    baseRevision: conflict.baseRevision,
                    remoteRevision: conflict.remoteRevision,
                    message: conflict.message
                };
            }
        });
        return {
            available: available(),
            initialized: initialized,
            signedIn: !!currentUser,
            phase: state.phase,
            hydrated: !!currentUser && domains.plan.hydrated && domains.tracker.hydrated,
            pending: pending,
            conflicts: conflicts,
            error: state.error,
            retryAt: retryAt
        };
    }

    function notifyStatus() {
        var snapshot = statusSnapshot();
        statusListeners.slice().forEach(function (listener) {
            try { listener(snapshot); } catch (error) { global.setTimeout(function () { throw error; }, 0); }
        });
    }

    function setPhase(phase, error) {
        state.phase = phase;
        state.error = errorText(error);
        notifyStatus();
    }

    function notifyAuth() {
        authListeners.slice().forEach(function (listener) {
            try { listener(currentUser); } catch (error) { global.setTimeout(function () { throw error; }, 0); }
        });
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function storesReady() {
        return !!(global.FireStore && global.TrackerStore);
    }

    function snapshotLocal() {
        if (!storesReady()) return null;
        return {
            schemaVersion: SCHEMA_VERSION,
            plan: clone(global.FireStore.get()),
            tracker: clone(global.TrackerStore.get())
        };
    }

    function readLocalSnapshot(key) {
        try {
            var value = JSON.parse(global.localStorage.getItem(key));
            return value && value.schemaVersion === SCHEMA_VERSION &&
                validPlan(value.plan) && validTracker(value.tracker) ? value : null;
        } catch (error) { return null; }
    }

    function saveLocalSnapshot(key, includeBlank) {
        if (!storesReady()) return false;
        try {
            if (!includeBlank && global.FireStore.isDefault() && global.TrackerStore.isEmpty()) {
                global.localStorage.removeItem(key);
                return true;
            }
            var encoded = JSON.stringify(snapshotLocal());
            global.localStorage.setItem(key, encoded);
            return global.localStorage.getItem(key) === encoded;
        } catch (error) { return false; }
    }

    function adoptLocalSnapshot(snapshot) {
        if (!storesReady()) return;
        applying = true;
        try {
            if (snapshot) {
                global.FireStore.replace(snapshot.plan);
                global.TrackerStore.replace(snapshot.tracker);
            } else {
                global.FireStore.reset();
                global.TrackerStore.reset();
            }
        } finally {
            applying = false;
        }
    }

    function object(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function integer(value, min, max) {
        return Number.isInteger(value) && value >= min && (max === undefined || value <= max);
    }

    function exactKeys(value, keys) {
        if (!object(value)) return false;
        var actual = Object.keys(value).sort();
        var expected = keys.slice().sort();
        return actual.length === expected.length && actual.every(function (key, index) {
            return key === expected[index];
        });
    }

    function hashString(text) {
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return 'fnv1a-' + text.length + '-' + ('00000000' + (hash >>> 0).toString(16)).slice(-8);
    }

    function stableStringify(value) {
        if (Array.isArray(value)) {
            return '[' + value.map(stableStringify).join(',') + ']';
        }
        if (object(value)) {
            return '{' + Object.keys(value).sort().map(function (key) {
                return JSON.stringify(key) + ':' + stableStringify(value[key]);
            }).join(',') + '}';
        }
        return JSON.stringify(value);
    }

    function serializeData(name, value) {
        var data = clone(value);
        var json = JSON.stringify(data);
        return { data: data, json: json, hash: hashString(name === 'plan' ? stableStringify(data) : json) };
    }

    function serialize(name) {
        return serializeData(name, name === 'plan' ? global.FireStore.get() : global.TrackerStore.get());
    }

    function utf8Length(text) {
        var bytes = 0;
        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);
            if (code < 0x80) bytes++;
            else if (code < 0x800) bytes += 2;
            else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length &&
                text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
                bytes += 4;
                i++;
            } else bytes += 3;
        }
        return bytes;
    }

    function splitChunks(text) {
        var chunks = [], start = 0, bytes = 0;
        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);
            var width = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
            var pair = code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length &&
                text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF;
            if (pair) width = 4;
            if (bytes && bytes + width > CHUNK_SIZE) {
                chunks.push(text.slice(start, i));
                start = i;
                bytes = 0;
            }
            bytes += width;
            if (pair) { bytes += 0; i++; }
        }
        chunks.push(text.slice(start));
        if (!chunks.length) chunks.push('');
        if (chunks.length > MAX_CHUNKS) {
            throw cloudError('firecloud/too-large', 'Tracker data is too large for cloud sync');
        }
        return chunks;
    }

    function chunkId(index) {
        return 'c' + String(index).padStart(4, '0');
    }

    function cloudError(code, message, details) {
        var error = new Error(message);
        error.code = code;
        if (details) Object.keys(details).forEach(function (key) { error[key] = details[key]; });
        return error;
    }

    function serverTimestamp() {
        return global.firebase.firestore.FieldValue.serverTimestamp();
    }

    function userRef(uid) {
        return db.collection('users').doc(uid);
    }

    function stateRef(uid, name) {
        return userRef(uid).collection('state').doc(name);
    }

    function chunkRef(uid, index) {
        return userRef(uid).collection('trackerChunks').doc(chunkId(index));
    }

    function emptyRecord() {
        return {
            schemaVersion: SCHEMA_VERSION,
            plan: { revision: 0, lastHash: null, pendingHash: null, dirty: false },
            tracker: { revision: 0, lastHash: null, pendingHash: null, dirty: false }
        };
    }

    function loadRecord(uid) {
        try {
            var parsed = JSON.parse(global.localStorage.getItem(SYNC_PREFIX + uid));
            if (parsed && parsed.schemaVersion === SCHEMA_VERSION &&
                object(parsed.plan) && object(parsed.tracker)) {
                ['plan', 'tracker'].forEach(function (name) {
                    if (!integer(parsed[name].revision, 0)) parsed[name].revision = 0;
                    if (typeof parsed[name].lastHash !== 'string') parsed[name].lastHash = null;
                    if (typeof parsed[name].pendingHash !== 'string') parsed[name].pendingHash = null;
                    parsed[name].dirty = parsed[name].dirty === true;
                });
                return parsed;
            }
        } catch (error) { /* unavailable or invalid */ }
        return emptyRecord();
    }

    function saveRecord() {
        if (!currentUser || !record) return;
        try { global.localStorage.setItem(SYNC_PREFIX + currentUser.uid, JSON.stringify(record)); } catch (error) { /* unavailable */ }
    }

    function localOwner() {
        try { return global.localStorage.getItem(OWNER_KEY); } catch (error) { return null; }
    }

    function setLocalOwner(uid) {
        try {
            if (uid) global.localStorage.setItem(OWNER_KEY, uid);
            else global.localStorage.removeItem(OWNER_KEY);
        } catch (error) { /* unavailable */ }
    }

    function validPlan(value) {
        return object(value) && object(value.inputs) && object(value.profile) &&
            Array.isArray(value.phases) && Number.isFinite(Number(value.mcSeed));
    }

    function validTracker(value) {
        return object(value) && Array.isArray(value.accounts) && object(value.snapshots) &&
            object(value.ageIncome) && Array.isArray(value.txns) && Array.isArray(value.cashMonths) &&
            object(value.categoryKinds) && object(value.csvColumns);
    }

    function allowedKeys(value, required, optional) {
        if (!object(value)) return false;
        var allowed = required.concat(optional);
        return required.every(function (key) {
            return Object.prototype.hasOwnProperty.call(value, key);
        }) && Object.keys(value).every(function (key) {
            return allowed.indexOf(key) >= 0;
        });
    }

    function validLegacyTracker(value) {
        if (!allowedKeys(value,
            ['accounts', 'snapshots', 'ageIncome', 'txns', 'cashMonths'],
            ['categoryKinds', 'csvColumns'])) return false;
        return Array.isArray(value.accounts) && object(value.snapshots) && object(value.ageIncome) &&
            Array.isArray(value.txns) && Array.isArray(value.cashMonths) &&
            (!Object.prototype.hasOwnProperty.call(value, 'categoryKinds') || object(value.categoryKinds)) &&
            (!Object.prototype.hasOwnProperty.call(value, 'csvColumns') || object(value.csvColumns));
    }

    function validLegacyRoot(value) {
        return exactKeys(value, ['version', 'plan', 'tracker', 'updatedAt']) &&
            value.version === LEGACY_SCHEMA_VERSION &&
            exactKeys(value.plan, ['inputs', 'profile', 'phases', 'mcSeed']) &&
            validPlan(value.plan) && validLegacyTracker(value.tracker) &&
            value.updatedAt !== undefined;
    }

    function upgradeLegacySnapshot(value) {
        if (!validLegacyRoot(value)) {
            throw cloudError('firecloud/schema', 'Legacy cloud state failed validation');
        }
        var tracker = clone(value.tracker);
        if (!Object.prototype.hasOwnProperty.call(tracker, 'categoryKinds')) tracker.categoryKinds = {};
        if (!Object.prototype.hasOwnProperty.call(tracker, 'csvColumns')) tracker.csvColumns = {};
        return {
            plan: serializeData('plan', value.plan),
            tracker: serializeData('tracker', tracker)
        };
    }

    function validManifest(value) {
        return exactKeys(value, ['schemaVersion', 'updatedAt']) &&
            value.schemaVersion === SCHEMA_VERSION && value.updatedAt !== undefined;
    }

    function validPlanDoc(value) {
        return exactKeys(value, ['schemaVersion', 'revision', 'data', 'updatedAt']) &&
            value.schemaVersion === SCHEMA_VERSION && integer(value.revision, 1) &&
            validPlan(value.data) && value.updatedAt !== undefined;
    }

    function validTrackerMeta(value) {
        return exactKeys(value, ['schemaVersion', 'revision', 'chunkCount', 'digest', 'updatedAt']) &&
            value.schemaVersion === SCHEMA_VERSION && integer(value.revision, 1) &&
            integer(value.chunkCount, 1, MAX_CHUNKS) && typeof value.digest === 'string' &&
            value.digest.length <= 80 && value.updatedAt !== undefined;
    }

    function validChunk(value, index, meta) {
        return exactKeys(value, ['schemaVersion', 'revision', 'index', 'count', 'data', 'updatedAt']) &&
            value.schemaVersion === SCHEMA_VERSION && value.revision === meta.revision &&
            value.index === index && value.count === meta.chunkCount &&
            typeof value.data === 'string' && utf8Length(value.data) <= CHUNK_SIZE &&
            value.updatedAt !== undefined;
    }

    function migrateLegacy(transaction, uid, rootData, planSnap, trackerSnap) {
        if (planSnap.exists || trackerSnap.exists) {
            throw cloudError('firecloud/schema', 'Legacy cloud state contains partial v2 data');
        }
        var upgraded = upgradeLegacySnapshot(rootData);
        upgraded.tracker.chunks = splitChunks(upgraded.tracker.json);
        writeManifest(transaction, uid);
        writePlan(transaction, uid, upgraded.plan, 1);
        writeTracker(transaction, uid, upgraded.tracker, 1, 0);
        return {
            kind: 'existing',
            migrated: true,
            plan: { data: upgraded.plan.data, revision: 1, hash: upgraded.plan.hash },
            tracker: { data: upgraded.tracker.data, revision: 1, hash: upgraded.tracker.hash }
        };
    }

    function parseRemote(manifestSnap, planSnap, trackerSnap, chunkSnaps) {
        if (!manifestSnap.exists) {
            if (planSnap.exists || trackerSnap.exists) {
                throw cloudError('firecloud/schema', 'Cloud state contains orphaned documents');
            }
            return { kind: 'fresh' };
        }
        var manifest = manifestSnap.data();
        if (!manifest || manifest.schemaVersion !== SCHEMA_VERSION) {
            throw cloudError('firecloud/schema', 'Cloud root has an unknown schema');
        }
        if (!validManifest(manifest)) throw cloudError('firecloud/schema', 'Cloud manifest is invalid');
        if (!planSnap.exists || !trackerSnap.exists) {
            throw cloudError('firecloud/schema', 'Cloud state is incomplete');
        }
        var plan = planSnap.data();
        var tracker = trackerSnap.data();
        if (!validPlanDoc(plan) || !validTrackerMeta(tracker)) {
            throw cloudError('firecloud/schema', 'Cloud state failed validation');
        }
        if (!chunkSnaps || chunkSnaps.length !== tracker.chunkCount) {
            throw cloudError('firecloud/schema', 'Cloud tracker chunks are incomplete');
        }
        var json = '';
        chunkSnaps.forEach(function (snapshot, index) {
            if (!snapshot.exists || !validChunk(snapshot.data(), index, tracker)) {
                throw cloudError('firecloud/schema', 'Cloud tracker chunk failed validation');
            }
            json += snapshot.data().data;
        });
        if (hashString(json) !== tracker.digest) {
            throw cloudError('firecloud/schema', 'Cloud tracker digest did not match');
        }
        var trackerData;
        try { trackerData = JSON.parse(json); } catch (error) {
            throw cloudError('firecloud/schema', 'Cloud tracker JSON is invalid');
        }
        if (!validTracker(trackerData)) {
            throw cloudError('firecloud/schema', 'Cloud tracker data failed validation');
        }
        return {
            kind: 'existing',
            plan: { data: plan.data, revision: plan.revision, hash: hashString(stableStringify(plan.data)) },
            tracker: { data: trackerData, revision: tracker.revision, hash: tracker.digest }
        };
    }

    function readRemote(uid) {
        var root = userRef(uid);
        var plan = stateRef(uid, 'plan');
        var tracker = stateRef(uid, 'tracker');
        return db.runTransaction(function (transaction) {
            return Promise.all([transaction.get(root), transaction.get(plan), transaction.get(tracker)])
                .then(function (snapshots) {
                    var rootData = snapshots[0].exists ? snapshots[0].data() : null;
                    if (rootData && rootData.version === LEGACY_SCHEMA_VERSION) {
                        return migrateLegacy(transaction, uid, rootData, snapshots[1], snapshots[2]);
                    }
                    var trackerData = snapshots[2].exists ? snapshots[2].data() : null;
                    if (!snapshots[0].exists || !trackerData ||
                        snapshots[0].data().schemaVersion !== SCHEMA_VERSION) {
                        return parseRemote(snapshots[0], snapshots[1], snapshots[2], []);
                    }
                    if (!validTrackerMeta(trackerData)) {
                        return parseRemote(snapshots[0], snapshots[1], snapshots[2], []);
                    }
                    var reads = [];
                    for (var i = 0; i < trackerData.chunkCount; i++) reads.push(transaction.get(chunkRef(uid, i)));
                    return Promise.all(reads).then(function (chunks) {
                        return parseRemote(snapshots[0], snapshots[1], snapshots[2], chunks);
                    });
                });
        });
    }

    function adopt(name, data) {
        applying = true;
        try {
            if (name === 'plan') global.FireStore.replace(data);
            else global.TrackerStore.replace(data);
        } finally {
            applying = false;
        }
    }

    function markClean(name, revision, hash) {
        var domain = domains[name];
        domain.hydrated = true;
        domain.dirty = false;
        domain.sessionDirty = false;
        domain.baseRevision = revision;
        domain.lastHash = hash;
        domain.conflict = null;
        record[name] = { revision: revision, lastHash: hash, pendingHash: null, dirty: false };
    }

    function markDirty(name, revision, lastHash, pendingHash) {
        var domain = domains[name];
        domain.hydrated = true;
        domain.dirty = true;
        domain.baseRevision = revision;
        domain.lastHash = lastHash;
        domain.conflict = null;
        record[name] = {
            revision: revision,
            lastHash: lastHash,
            pendingHash: pendingHash || serialize(name).hash,
            dirty: true
        };
    }

    function markConflict(name, remoteRevision) {
        var domain = domains[name];
        domain.hydrated = true;
        domain.dirty = true;
        domain.conflict = {
            baseRevision: domain.baseRevision,
            remoteRevision: remoteRevision,
            message: 'Cloud data changed on another device'
        };
        record[name].dirty = true;
        record[name].pendingHash = serialize(name).hash;
    }

    function reconcile(name, remote, initial, owner) {
        var domain = domains[name];
        var local = serialize(name);
        var saved = record[name];
        var owned = owner === currentUser.uid;
        var localMismatch = owned && !!saved.lastHash && initial.hash !== saved.lastHash;
        var changedBeforeSignIn = owned && saved.dirty;
        var unknownOwnedBaseline = owned &&
            ((saved.revision === 0 && initial.hash !== remote.hash) ||
                (localMismatch && !saved.dirty));
        if (owned && saved.dirty && saved.pendingHash && saved.pendingHash === initial.hash) {
            changedBeforeSignIn = true;
        }
        var changedDuringPull = domain.sessionDirty || local.hash !== initial.hash;

        if (local.hash === remote.hash) {
            markClean(name, remote.revision, local.hash);
        } else if (changedDuringPull && initial.hash !== remote.hash) {
            domain.baseRevision = saved.revision;
            domain.lastHash = saved.lastHash;
            markConflict(name, remote.revision);
        } else if (unknownOwnedBaseline ||
            (changedBeforeSignIn && (saved.revision === 0 || saved.revision !== remote.revision))) {
            domain.baseRevision = saved.revision;
            domain.lastHash = saved.lastHash;
            markConflict(name, remote.revision);
        } else if (changedBeforeSignIn || changedDuringPull) {
            markDirty(name, remote.revision, remote.hash, local.hash);
        } else {
            adopt(name, remote.data);
            var adopted = serialize(name);
            markClean(name, remote.revision, adopted.hash);
        }
    }

    function writeManifest(transaction, uid) {
        transaction.set(userRef(uid), { schemaVersion: SCHEMA_VERSION, updatedAt: serverTimestamp() });
    }

    function writePlan(transaction, uid, payload, revision) {
        transaction.set(stateRef(uid, 'plan'), {
            schemaVersion: SCHEMA_VERSION,
            revision: revision,
            data: payload.data,
            updatedAt: serverTimestamp()
        });
    }

    function writeTracker(transaction, uid, payload, revision, previousCount) {
        var chunks = payload.chunks || splitChunks(payload.json);
        transaction.set(stateRef(uid, 'tracker'), {
            schemaVersion: SCHEMA_VERSION,
            revision: revision,
            chunkCount: chunks.length,
            digest: payload.hash,
            updatedAt: serverTimestamp()
        });
        chunks.forEach(function (data, index) {
            transaction.set(chunkRef(uid, index), {
                schemaVersion: SCHEMA_VERSION,
                revision: revision,
                index: index,
                count: chunks.length,
                data: data,
                updatedAt: serverTimestamp()
            });
        });
        for (var i = chunks.length; i < previousCount; i++) transaction.delete(chunkRef(uid, i));
    }

    function seedRemote(uid, expectedGeneration) {
        if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) {
            return Promise.resolve(false);
        }
        var planPayload = serialize('plan');
        var trackerPayload = serialize('tracker');
        trackerPayload.chunks = splitChunks(trackerPayload.json);
        return db.runTransaction(function (transaction) {
            return Promise.all([
                transaction.get(userRef(uid)),
                transaction.get(stateRef(uid, 'plan')),
                transaction.get(stateRef(uid, 'tracker'))
            ]).then(function (snapshots) {
                if (snapshots[0].exists) {
                    var rootData = snapshots[0].data();
                    if ((rootData && rootData.schemaVersion === SCHEMA_VERSION) || validLegacyRoot(rootData)) {
                        throw cloudError('firecloud/conflict', 'Cloud account was created on another device', {
                            remoteRevision: 1
                        });
                    }
                    throw cloudError('firecloud/schema', 'Cloud root has an unknown schema');
                }
                if (snapshots[1].exists || snapshots[2].exists) {
                    throw cloudError('firecloud/schema', 'Cloud account contains incomplete state');
                }
                writeManifest(transaction, uid);
                writePlan(transaction, uid, planPayload, 1);
                writeTracker(transaction, uid, trackerPayload, 1, 0);
            });
        }).then(function () {
            if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) return false;
            var currentPlan = serialize('plan');
            var currentTracker = serialize('tracker');
            markClean('plan', 1, planPayload.hash);
            markClean('tracker', 1, trackerPayload.hash);
            if (currentPlan.hash !== planPayload.hash) markDirty('plan', 1, planPayload.hash, currentPlan.hash);
            if (currentTracker.hash !== trackerPayload.hash) markDirty('tracker', 1, trackerPayload.hash, currentTracker.hash);
            setLocalOwner(uid);
            saveRecord();
            retryDelay = 1000;
            setPhase(domains.plan.dirty || domains.tracker.dirty ? 'dirty' : 'synced');
            if (domains.plan.dirty || domains.tracker.dirty) schedulePush();
            toast('Signed in - this device\'s data is now saved to your account');
            return true;
        });
    }

    function askToSeed(uid, expectedGeneration) {
        var candidate = pendingSeedCandidate;
        var hasLocal = !!candidate || !global.FireStore.isDefault() || !global.TrackerStore.isEmpty();
        if (!hasLocal) {
            pendingSeedCandidate = null;
            return Promise.resolve(true);
        }
        if (!global.FireApp || typeof global.FireApp.confirm !== 'function') {
            toast('Nothing was saved - confirmation is required before uploading local data');
            return Promise.resolve(false);
        }
        return new Promise(function (resolve) {
            var settled = false;
            var finish = function (answer) {
                if (settled) return;
                settled = true;
                if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) {
                    resolve(false);
                    return;
                }
                if (answer && candidate) adoptLocalSnapshot(candidate);
                if (answer) setLocalOwner(uid);
                pendingSeedCandidate = null;
                resolve(answer);
            };
            try {
                global.FireApp.confirm(
                    'This device already holds data. Save it to this new account?',
                    function () { finish(true); },
                    'Save it',
                    { strict: true, onCancel: function () { finish(false); } }
                );
            } catch (error) {
                finish(false);
            }
        });
    }

    function clearRetry() {
        if (retryTimer) global.clearTimeout(retryTimer);
        retryTimer = null;
        retryAction = null;
        retryAt = null;
    }

    function queueRetry(action, error) {
        clearRetry();
        retryAction = action;
        var delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 30000);
        retryAt = Date.now() + delay;
        setPhase('retrying', error);
        retryTimer = global.setTimeout(function () {
            retryTimer = null;
            retryAt = null;
            var next = retryAction;
            retryAction = null;
            if (next) next();
        }, delay);
    }

    function hydrate(user, expectedGeneration) {
        if (hydrationPromise) return hydrationPromise;
        if (!global.FireStore || !global.TrackerStore) {
            setPhase('error', new Error('Local stores are not ready'));
            return Promise.resolve(false);
        }
        var uid = user.uid;
        var owner = localOwner();
        var initial = { plan: serialize('plan'), tracker: serialize('tracker') };
        setPhase('hydrating');
        var operation = readRemote(uid).then(function (remote) {
            if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) return false;
            if (remote.kind === 'fresh') {
                return askToSeed(uid, expectedGeneration).then(function (confirmed) {
                    if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) return false;
                    if (!confirmed) {
                        toast('Nothing was saved - clear this device\'s data first for a blank account');
                        return signOut().then(function () { return false; });
                    }
                    return seedRemote(uid, expectedGeneration);
                });
            }
            pendingSeedCandidate = null;
            reconcile('plan', remote.plan, initial.plan, owner);
            reconcile('tracker', remote.tracker, initial.tracker, owner);
            setLocalOwner(uid);
            saveRecord();
            retryDelay = 1000;
            if (domains.plan.conflict || domains.tracker.conflict) {
                setPhase('conflict');
                toast('Cloud data changed elsewhere - choose which copy to keep');
            } else if (domains.plan.dirty || domains.tracker.dirty) {
                setPhase('dirty');
                schedulePush();
            } else {
                setPhase('synced');
                toast(remote.migrated ?
                    'Signed in - your cloud data was upgraded and loaded' :
                    'Signed in - your saved data loaded');
            }
            return true;
        }).catch(function (error) {
            if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) return false;
            if (error && error.code === 'firecloud/conflict') {
                ['plan', 'tracker'].forEach(function (name) {
                    domains[name].baseRevision = 0;
                    markConflict(name, integer(error.remoteRevision, 0) ? error.remoteRevision : 1);
                });
                saveRecord();
                setPhase('conflict', error);
                toast('Cloud data was created elsewhere - choose which copy to keep');
            } else if (error && (error.code === 'firecloud/schema' || error.code === 'firecloud/too-large')) {
                setPhase('error', error);
                toast('Cloud data could not be loaded safely');
            } else if (retryable(error)) {
                queueRetry(function () { hydrate(user, expectedGeneration); }, error);
                toast('Signed in, but loading your data failed - retrying');
            } else {
                setPhase('error', error);
                toast('Cloud data could not be loaded: ' + errorText(error));
            }
            return false;
        });
        var tracked = operation.then(function (result) {
            if (hydrationPromise === tracked) hydrationPromise = null;
            return result;
        }, function (error) {
            if (hydrationPromise === tracked) hydrationPromise = null;
            throw error;
        });
        hydrationPromise = tracked;
        return tracked;
    }

    function currentRemoteRevision(snapshot, validator) {
        if (!snapshot.exists) return 0;
        var value = snapshot.data();
        if (!validator(value)) throw cloudError('firecloud/schema', 'Cloud state failed validation');
        return value.revision;
    }

    function pushPlan(uid, expectedGeneration, payload, baseRevision) {
        return db.runTransaction(function (transaction) {
            return transaction.get(stateRef(uid, 'plan')).then(function (snapshot) {
                var remoteRevision = currentRemoteRevision(snapshot, validPlanDoc);
                if (remoteRevision !== baseRevision) {
                    throw cloudError('firecloud/conflict', 'Plan changed on another device', {
                        remoteRevision: remoteRevision
                    });
                }
                writeManifest(transaction, uid);
                writePlan(transaction, uid, payload, baseRevision + 1);
            });
        }).then(function () {
            return finishPush('plan', uid, expectedGeneration, payload, baseRevision + 1);
        });
    }

    function pushTracker(uid, expectedGeneration, payload, baseRevision) {
        payload.chunks = splitChunks(payload.json);
        return db.runTransaction(function (transaction) {
            return transaction.get(stateRef(uid, 'tracker')).then(function (snapshot) {
                var remoteRevision = currentRemoteRevision(snapshot, validTrackerMeta);
                if (remoteRevision !== baseRevision) {
                    throw cloudError('firecloud/conflict', 'Tracker changed on another device', {
                        remoteRevision: remoteRevision
                    });
                }
                var previousCount = snapshot.exists ? snapshot.data().chunkCount : 0;
                writeManifest(transaction, uid);
                writeTracker(transaction, uid, payload, baseRevision + 1, previousCount);
            });
        }).then(function () {
            return finishPush('tracker', uid, expectedGeneration, payload, baseRevision + 1);
        });
    }

    function finishPush(name, uid, expectedGeneration, payload, revision) {
        if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) return false;
        var latest = serialize(name);
        var domain = domains[name];
        domain.baseRevision = revision;
        domain.lastHash = payload.hash;
        domain.conflict = null;
        record[name].revision = revision;
        record[name].lastHash = payload.hash;
        if (latest.hash === payload.hash) {
            domain.dirty = false;
            domain.sessionDirty = false;
            record[name].dirty = false;
            record[name].pendingHash = null;
        } else {
            domain.dirty = true;
            record[name].dirty = true;
            record[name].pendingHash = latest.hash;
        }
        saveRecord();
        return true;
    }

    function handlePushError(name, error, uid, expectedGeneration) {
        if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration || !record) return false;
        var domain = domains[name];
        if (error && error.code === 'firecloud/conflict') {
            markConflict(name, integer(error.remoteRevision, 0) ? error.remoteRevision : 0);
            saveRecord();
            setPhase('conflict', error);
            toast('Cloud data changed elsewhere - choose which copy to keep');
        } else if (error && (error.code === 'firecloud/schema' || error.code === 'firecloud/too-large')) {
            setPhase('error', error);
            toast(error.code === 'firecloud/too-large' ?
                'Tracker data is too large for cloud sync' : 'Cloud data failed validation');
        } else if (retryable(error)) {
            queueRetry(flushDirty, error);
        } else {
            setPhase('error', error);
            toast('Cloud changes could not be saved: ' + errorText(error));
        }
        return false;
    }

    function flushDirty() {
        if (flushPromise) return flushPromise;
        if (!currentUser || !domains.plan.hydrated || !domains.tracker.hydrated) return Promise.resolve(false);
        if (pushTimer) global.clearTimeout(pushTimer);
        pushTimer = null;
        var uid = currentUser.uid;
        var expectedGeneration = generation;
        var work = [];
        setPhase('syncing');
        ['plan', 'tracker'].forEach(function (name) {
            var domain = domains[name];
            if (!domain.dirty || domain.conflict) return;
            var payload;
            try { payload = serialize(name); } catch (error) {
                work.push(Promise.resolve(handlePushError(name, error, uid, expectedGeneration)));
                return;
            }
            var push = name === 'plan' ? pushPlan : pushTracker;
            try {
                work.push(push(uid, expectedGeneration, payload, domain.baseRevision)
                    .catch(function (error) { return handlePushError(name, error, uid, expectedGeneration); }));
            } catch (error) {
                work.push(Promise.resolve(handlePushError(name, error, uid, expectedGeneration)));
            }
        });
        if (!work.length) {
            setPhase(domains.plan.conflict || domains.tracker.conflict ? 'conflict' : 'synced');
            return Promise.resolve(!(domains.plan.conflict || domains.tracker.conflict));
        }
        var operation = Promise.all(work).then(function (results) {
            if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) return false;
            if (results.every(Boolean)) {
                retryDelay = 1000;
                clearRetry();
            }
            if (domains.plan.conflict || domains.tracker.conflict) setPhase('conflict');
            else if (state.phase === 'error' && !results.every(Boolean)) notifyStatus();
            else if (domains.plan.dirty || domains.tracker.dirty) {
                if (!retryTimer) setPhase('dirty');
                if (results.every(Boolean)) schedulePush();
            } else setPhase('synced');
            return results.every(Boolean);
        });
        var tracked = operation.finally(function () {
            if (flushPromise === tracked) flushPromise = null;
        });
        flushPromise = tracked;
        return tracked;
    }

    function schedulePush() {
        if (!currentUser || !domains.plan.hydrated || !domains.tracker.hydrated) return;
        if (pushTimer) global.clearTimeout(pushTimer);
        pushTimer = global.setTimeout(function () { flushDirty(); }, PUSH_DEBOUNCE);
    }

    function onStoreChange(name) {
        if (applying) return;
        if (!currentUser) return;
        var domain = domains[name];
        if (!domain.hydrated && !localOwner()) setLocalOwner(currentUser.uid);
        domain.dirty = true;
        domain.sessionDirty = true;
        if (record) {
            record[name].dirty = true;
            record[name].pendingHash = serialize(name).hash;
            saveRecord();
        }
        if (domain.conflict) setPhase('conflict');
        else if (domain.hydrated) {
            setPhase('dirty');
            schedulePush();
        } else notifyStatus();
    }

    function wireStores() {
        if (wired) return true;
        if (!global.FireStore || typeof global.FireStore.subscribe !== 'function' ||
            !global.TrackerStore || typeof global.TrackerStore.subscribe !== 'function') return false;
        wired = true;
        global.FireStore.subscribe(function () { onStoreChange('plan'); });
        global.TrackerStore.subscribe(function () { onStoreChange('tracker'); });
        return true;
    }

    function remoteCurrent(uid) {
        return !!(currentUser && currentUser.uid === uid &&
            domains.plan.hydrated && domains.tracker.hydrated &&
            !domains.plan.dirty && !domains.tracker.dirty &&
            !domains.plan.conflict && !domains.tracker.conflict);
    }

    function onSignIn(user) {
        if (currentUser && currentUser.uid === user.uid) return;
        var previousUid = currentUser ? currentUser.uid : localOwner();
        var sameOwner = !currentUser && previousUid === user.uid;
        var preserved = sameOwner || (previousUid ?
            saveLocalSnapshot(LOCAL_PREFIX + previousUid, true) :
            saveLocalSnapshot(ANON_LOCAL_KEY, false));
        if (!preserved && previousUid && remoteCurrent(previousUid)) preserved = true;
        if (!preserved) {
            var preservationError = cloudError('firecloud/local-storage', 'Local data could not be protected during account switch');
            generation++;
            currentUser = null;
            record = null;
            domains = freshDomains();
            hydrationPromise = null;
            flushPromise = null;
            clearRetry();
            setPhase('error', preservationError);
            notifyAuth();
            toast('Account switch stopped because local data could not be saved safely');
            if (auth) Promise.resolve(auth.signOut()).catch(function () {});
            return;
        }

        var ownSnapshot = sameOwner ? snapshotLocal() : readLocalSnapshot(LOCAL_PREFIX + user.uid);
        pendingSeedCandidate = ownSnapshot ? null : readLocalSnapshot(ANON_LOCAL_KEY);
        if (!sameOwner) adoptLocalSnapshot(ownSnapshot);
        setLocalOwner(ownSnapshot ? user.uid : null);
        generation++;
        clearRetry();
        if (pushTimer) global.clearTimeout(pushTimer);
        pushTimer = null;
        hydrationPromise = null;
        flushPromise = null;
        currentUser = user;
        domains = freshDomains();
        record = loadRecord(user.uid);
        notifyAuth();
        hydrate(user, generation);
    }

    function onSignOut() {
        var previousUid = currentUser ? currentUser.uid : localOwner();
        var safeToDiscard = previousUid && remoteCurrent(previousUid);
        var preserved = previousUid ? saveLocalSnapshot(LOCAL_PREFIX + previousUid, true) :
            saveLocalSnapshot(ANON_LOCAL_KEY, false);
        if (!preserved && safeToDiscard) preserved = true;
        generation++;
        currentUser = null;
        record = null;
        pendingSeedCandidate = null;
        domains = freshDomains();
        hydrationPromise = null;
        flushPromise = null;
        if (pushTimer) global.clearTimeout(pushTimer);
        pushTimer = null;
        clearRetry();
        if (!preserved) {
            setPhase('error', cloudError('firecloud/local-storage', 'Local data could not be protected during sign-out'));
            notifyAuth();
            toast('Signed out, but local data remains visible because it could not be copied safely');
            return;
        }
        setLocalOwner(null);
        adoptLocalSnapshot(readLocalSnapshot(ANON_LOCAL_KEY));
        setPhase('signed-out');
        notifyAuth();
    }

    function configure() {
        if (initialized) return true;
        if (!sdkReady()) throw new Error('Firebase SDK is incomplete');
        var fb = global.firebase;
        var config = global.FirebaseConfig;
        if (!config || !config.apiKey || !config.projectId) throw new Error('Firebase config is incomplete');
        try {
            if (!fb.apps || !fb.apps.length) fb.initializeApp(config);
            else if (typeof fb.app === 'function') {
                var existing = fb.app();
                if (existing.options && existing.options.projectId && existing.options.projectId !== config.projectId) {
                    throw new Error('Firebase app project does not match FirebaseConfig');
                }
            }
            auth = fb.auth();
            db = fb.firestore();
            if (!auth || !db) throw new Error('Firebase services did not initialize');
            initialized = true;
            setPhase('initializing');
            auth.onAuthStateChanged(function (user) {
                if (user) onSignIn(user);
                else onSignOut();
            }, function (error) {
                setPhase('error', error);
                console.warn('[FireCloud] auth state failed', error);
            });
            return true;
        } catch (error) {
            initialized = false;
            auth = null;
            db = null;
            throw error;
        }
    }

    function ensureReady(preload) {
        wireStores();
        if (initialized) return Promise.resolve(true);
        if (!available()) return Promise.resolve(false);
        if (initPromise) {
            if (!preload && !sdkReady() && global.FirebaseLoader) global.FirebaseLoader.load();
            return initPromise;
        }
        if (sdkReady()) {
            try {
                configure();
                return Promise.resolve(true);
            } catch (error) {
                setPhase('error', error);
                return Promise.resolve(false);
            }
        }
        setPhase('loading-sdk');
        var loader = global.FirebaseLoader;
        var operation = preload ? loader.preload() : loader.load();
        initPromise = operation.then(function () {
            configure();
            return true;
        }).catch(function (error) {
            setPhase('error', error);
            console.warn('[FireCloud] initialization failed', error);
            return false;
        }).then(function (result) {
            initPromise = null;
            return result;
        });
        return initPromise;
    }

    function signOut() {
        if (!auth) return Promise.resolve(false);
        if (currentUser && !saveLocalSnapshot(LOCAL_PREFIX + currentUser.uid, true) &&
            !remoteCurrent(currentUser.uid)) {
            var error = cloudError('firecloud/local-storage', 'Local data could not be protected before sign-out');
            setPhase('error', error);
            toast('Sign-out stopped because local data could not be saved safely');
            return Promise.resolve(false);
        }
        return Promise.resolve(auth.signOut()).then(function () { return true; }).catch(function (error) {
            setPhase('error', error);
            toast('Sign-out failed: ' + errorText(error));
            return false;
        });
    }

    function resolveConflict(strategy, name) {
        if (strategy !== 'local' && strategy !== 'remote') {
            return Promise.reject(new Error('Conflict strategy must be local or remote'));
        }
        var names = name ? [name] : ['plan', 'tracker'];
        if (names.some(function (entry) { return entry !== 'plan' && entry !== 'tracker'; })) {
            return Promise.reject(new Error('Unknown cloud domain'));
        }
        if (!currentUser) return Promise.resolve(false);
        var uid = currentUser.uid;
        var expectedGeneration = generation;
        setPhase('hydrating');
        return readRemote(uid).then(function (remote) {
            if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) return false;
            if (remote.kind !== 'existing') throw cloudError('firecloud/schema', 'Cloud state no longer exists');
            names.forEach(function (domainName) {
                if (!domains[domainName].conflict) return;
                var value = remote[domainName];
                if (strategy === 'remote') {
                    adopt(domainName, value.data);
                    markClean(domainName, value.revision, serialize(domainName).hash);
                } else {
                    markDirty(domainName, value.revision, value.hash, serialize(domainName).hash);
                }
            });
            setLocalOwner(uid);
            saveRecord();
            if (domains.plan.conflict || domains.tracker.conflict) setPhase('conflict');
            else if (domains.plan.dirty || domains.tracker.dirty) {
                setPhase('dirty');
                return flushDirty();
            } else setPhase('synced');
            return true;
        }).catch(function (error) {
            if (!currentUser || currentUser.uid !== uid || generation !== expectedGeneration) return false;
            if (error && (error.code === 'firecloud/schema' || error.code === 'firecloud/too-large')) {
                setPhase('error', error);
                toast('Cloud conflict could not be resolved safely');
            } else if (retryable(error)) {
                queueRetry(function () { resolveConflict(strategy, name); }, error);
            } else {
                setPhase('error', error);
                toast('Cloud conflict could not be resolved: ' + errorText(error));
            }
            return false;
        });
    }

    global.FireCloud = {
        available: available,
        signedIn: function () { return !!currentUser; },
        user: function () { return currentUser; },
        status: statusSnapshot,
        onChange: function (listener) {
            authListeners.push(listener);
            return function () {
                var index = authListeners.indexOf(listener);
                if (index >= 0) authListeners.splice(index, 1);
            };
        },
        onStatus: function (listener) {
            statusListeners.push(listener);
            listener(statusSnapshot());
            return function () {
                var index = statusListeners.indexOf(listener);
                if (index >= 0) statusListeners.splice(index, 1);
            };
        },
        init: function () { return ensureReady(true); },
        flush: function () {
            clearRetry();
            if (!currentUser) return Promise.resolve(false);
            if (hydrationPromise) {
                return hydrationPromise.then(function () {
                    return domains.plan.hydrated && domains.tracker.hydrated ? flushDirty() : false;
                });
            }
            if (!domains.plan.hydrated || !domains.tracker.hydrated) {
                return hydrate(currentUser, generation).then(function () {
                    return domains.plan.hydrated && domains.tracker.hydrated ? flushDirty() : false;
                });
            }
            return flushDirty();
        },
        refresh: function () {
            if (!currentUser) return Promise.resolve(false);
            domains.plan.hydrated = false;
            domains.tracker.hydrated = false;
            return hydrate(currentUser, generation);
        },
        resolveConflict: resolveConflict,
        signIn: function () {
            return ensureReady(false).then(function (ready) {
                if (!ready || !auth) return false;
                var provider = new global.firebase.auth.GoogleAuthProvider();
                return auth.signInWithPopup(provider).then(function () { return true; }).catch(function (error) {
                    if (error && (error.code === 'auth/popup-blocked' ||
                        error.code === 'auth/operation-not-supported-in-this-environment')) {
                        return Promise.resolve(auth.signInWithRedirect(provider)).then(function () { return true; });
                    }
                    if (!error || (error.code !== 'auth/cancelled-popup-request' &&
                        error.code !== 'auth/popup-closed-by-user')) {
                        console.warn('[FireCloud] sign-in failed', error);
                        toast('Sign-in failed: ' + errorText(error));
                    }
                    return false;
                });
            }).catch(function (error) {
                setPhase('error', error);
                toast('Sign-in failed: ' + errorText(error));
                return false;
            });
        },
        signOut: signOut
    };

    if (global.addEventListener) {
        global.addEventListener('pagehide', function () { if (currentUser) flushDirty(); });
        if (global.document) {
            global.document.addEventListener('visibilitychange', function () {
                if (global.document.visibilityState === 'hidden' && currentUser) flushDirty();
            });
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
