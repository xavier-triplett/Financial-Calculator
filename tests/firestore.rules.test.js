const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const {
    deleteDoc,
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    writeBatch
} = require('firebase/firestore');

const projectId = 'demo-fire-calculator';
let environment;

function manifest() {
    return { schemaVersion: 2, updatedAt: serverTimestamp() };
}

function plan(revision = 1) {
    return {
        schemaVersion: 2,
        revision,
        data: {
            inputs: { income: 100000 },
            profile: { birthDate: null },
            phases: [],
            mcSeed: 1337
        },
        updatedAt: serverTimestamp()
    };
}

function tracker(revision = 1, chunkCount = 1) {
    return {
        schemaVersion: 2,
        revision,
        chunkCount,
        digest: 'fnv1a-2-5465b825',
        updatedAt: serverTimestamp()
    };
}

function chunk(revision = 1, index = 0, count = 1, data = '{}') {
    return {
        schemaVersion: 2,
        revision,
        index,
        count,
        data,
        updatedAt: serverTimestamp()
    };
}

function userDb(uid) {
    return environment.authenticatedContext(uid, { email: uid + '@example.com' }).firestore();
}

async function createTracker(db, uid, count = 1) {
    const batch = writeBatch(db);
    batch.set(doc(db, `users/${uid}/state/tracker`), tracker(1, count));
    for (let index = 0; index < count; index++) {
        batch.set(doc(db, `users/${uid}/trackerChunks/c${String(index).padStart(4, '0')}`),
            chunk(1, index, count, index === 0 ? '{}' : 'tail'));
    }
    await assertSucceeds(batch.commit());
}

before(async () => {
    const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
    environment = await initializeTestEnvironment({
        projectId,
        firestore: { rules }
    });
});

beforeEach(async () => {
    await environment.clearFirestore();
});

after(async () => {
    if (environment) await environment.cleanup();
});

test('requires authentication and isolates every user tree', async () => {
    const alice = userDb('alice');
    const bob = userDb('bob');
    const guest = environment.unauthenticatedContext().firestore();

    await assertSucceeds(setDoc(doc(alice, 'users/alice'), manifest()));
    await assertFails(getDoc(doc(guest, 'users/alice')));
    await assertFails(getDoc(doc(bob, 'users/alice')));
    await assertFails(setDoc(doc(bob, 'users/alice/state/plan'), plan()));
    await assertFails(setDoc(doc(alice, 'public/leak'), { value: true }));
});

test('accepts a valid v2 manifest and split plan', async () => {
    const db = userDb('alice');

    await assertSucceeds(setDoc(doc(db, 'users/alice'), manifest()));
    await assertSucceeds(setDoc(doc(db, 'users/alice/state/plan'), plan(1)));
    const saved = await assertSucceeds(getDoc(doc(db, 'users/alice/state/plan')));
    assert.equal(saved.data().revision, 1);

    await assertFails(setDoc(doc(db, 'users/alice/state/plan'), plan(3)));
    await assertSucceeds(setDoc(doc(db, 'users/alice/state/plan'), plan(2)));
    const invalid = plan(2);
    invalid.schemaVersion = 1;
    await assertFails(setDoc(doc(db, 'users/alice/state/plan'), invalid));
    await assertFails(deleteDoc(doc(db, 'users/alice/state/plan')));
});

test('requires tracker metadata and chunks in one atomic revision', async () => {
    const db = userDb('alice');
    await createTracker(db, 'alice');

    await assertFails(setDoc(doc(db, 'users/alice/state/tracker'), tracker(2, 1)));
    await assertFails(setDoc(doc(db, 'users/alice/trackerChunks/c0000'), chunk(2, 0, 1)));

    const batch = writeBatch(db);
    batch.set(doc(db, 'users/alice/state/tracker'), tracker(2, 1));
    batch.set(doc(db, 'users/alice/trackerChunks/c0000'), chunk(2, 0, 1, '{"ok":true}'));
    await assertSucceeds(batch.commit());
});

test('validates chunk identifiers, indices, counts, and size', async () => {
    const db = userDb('alice');
    const invalidId = writeBatch(db);
    invalidId.set(doc(db, 'users/alice/state/tracker'), tracker(1, 1));
    invalidId.set(doc(db, 'users/alice/trackerChunks/chunk-0'), chunk(1, 0, 1));
    await assertFails(invalidId.commit());

    const invalidIndex = writeBatch(db);
    invalidIndex.set(doc(db, 'users/alice/state/tracker'), tracker(1, 1));
    invalidIndex.set(doc(db, 'users/alice/trackerChunks/c0000'), chunk(1, 1, 1));
    await assertFails(invalidIndex.commit());

    const mismatchedId = writeBatch(db);
    mismatchedId.set(doc(db, 'users/alice/state/tracker'), tracker(1, 2));
    mismatchedId.set(doc(db, 'users/alice/trackerChunks/c0000'), chunk(1, 0, 2));
    mismatchedId.set(doc(db, 'users/alice/trackerChunks/c0001'), chunk(1, 0, 2));
    await assertFails(mismatchedId.commit());

    const missingTail = writeBatch(db);
    missingTail.set(doc(db, 'users/alice/state/tracker'), tracker(1, 2));
    missingTail.set(doc(db, 'users/alice/trackerChunks/c0000'), chunk(1, 0, 2));
    await assertFails(missingTail.commit());

    const tooLarge = writeBatch(db);
    tooLarge.set(doc(db, 'users/alice/state/tracker'), tracker(1, 1));
    tooLarge.set(doc(db, 'users/alice/trackerChunks/c0000'), chunk(1, 0, 1, 'x'.repeat(180001)));
    await assertFails(tooLarge.commit());
});

test('permits obsolete chunks to be removed only during a tracker advance', async () => {
    const db = userDb('alice');
    await createTracker(db, 'alice', 2);

    await assertFails(deleteDoc(doc(db, 'users/alice/trackerChunks/c0001')));

    const shrink = writeBatch(db);
    shrink.set(doc(db, 'users/alice/state/tracker'), tracker(2, 1));
    shrink.set(doc(db, 'users/alice/trackerChunks/c0000'), chunk(2, 0, 1));
    shrink.delete(doc(db, 'users/alice/trackerChunks/c0001'));
    await assertSucceeds(shrink.commit());
    const removed = await assertSucceeds(getDoc(doc(db, 'users/alice/trackerChunks/c0001')));
    assert.equal(removed.exists(), false);
});

test('accepts the maximum supported tracker chunk batch', async () => {
    const db = userDb('alice');
    await createTracker(db, 'alice', 40);
    const saved = await assertSucceeds(getDoc(doc(db, 'users/alice/state/tracker')));
    assert.equal(saved.data().chunkCount, 40);
});
