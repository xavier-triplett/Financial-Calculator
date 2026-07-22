const memory = {};
global.localStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
    setItem(key, value) { memory[key] = String(value); },
    removeItem(key) { delete memory[key]; }
};

require('../js/engine.js');
require('../js/util.js');
require('../js/store.js');

let failures = 0;
function check(name, condition, detail) {
    if (condition) console.log('ok:   ' + name);
    else {
        failures++;
        console.log('FAIL: ' + name + (detail ? ' — ' + detail : ''));
    }
}
function approx(actual, expected, tolerance = 1e-9) {
    return Math.abs(actual - expected) <= tolerance;
}
function phaseInvariant(phases, currentAge) {
    const ids = new Set();
    const ages = new Set();
    return phases.length > 0 && phases[0].isLocked && phases[0].age === currentAge &&
        phases.filter(p => p.isLocked).length === 1 && phases.every((p, index) => {
            const valid = Number.isFinite(p.id) && !ids.has(p.id) && !ages.has(p.age) &&
                Number.isInteger(p.age) && p.age >= currentAge &&
                p.deferred >= 0 && p.free >= 0 && p.taxable >= 0 &&
                approx(p.deferred + p.free + p.taxable, 100) &&
                (index === 0 || p.age > phases[index - 1].age);
            ids.add(p.id);
            ages.add(p.age);
            return valid;
        });
}

FireStore.init();
check('default state has a locked current phase', phaseInvariant(FireStore.get().phases, 30));

const now = new Date();
const validDob = String(now.getFullYear() - 40).padStart(4, '0') + '-01-01';
FireStore.setProfile('birthDate', validDob);
check('DOB derives current age', FireStore.get().inputs.currentAge === 40 && FireStore.age() === 40);
check('DOB moves the locked phase', phaseInvariant(FireStore.get().phases, 40));
FireStore.setProfile('birthDate', '');
check('clearing DOB clears stale derived age',
    FireStore.get().profile.birthDate === null && FireStore.age() === null &&
    FireStore.get().inputs.currentAge === FireEngine.DEFAULTS.currentAge &&
    phaseInvariant(FireStore.get().phases, FireEngine.DEFAULTS.currentAge));

const tooOldDob = String(now.getFullYear() - 100).padStart(4, '0') + '-01-01';
FireStore.setProfile('birthDate', tooOldDob);
check('DOB beyond model horizon is rejected',
    FireStore.get().profile.birthDate === null && FireStore.get().inputs.currentAge === 30);
FireStore.setProfile('birthDate', '2026-02-30');
check('invalid calendar DOB is rejected', FireStore.get().profile.birthDate === null);

FireStore.replace({
    inputs: { income: Infinity, expenses: -100, swr: 0, mcSims: 50.5 },
    profile: { birthDate: null },
    phases: [{ id: 7, age: 40, deferred: 0, free: 0, taxable: 100, isLocked: false }]
});
check('adoption normalizes invalid financial inputs',
    FireStore.get().inputs.income === FireEngine.DEFAULTS.income &&
    FireStore.get().inputs.expenses === 0 && FireStore.get().inputs.swr === 0.1 &&
    FireStore.get().inputs.mcSims === 51);
check('future-only adoption restores baseline phase',
    FireStore.get().phases.length === 2 && phaseInvariant(FireStore.get().phases, 30) &&
    FireStore.get().phases[1].age === 40 && FireStore.get().phases[1].taxable === 100);

FireStore.setPhases([
    { id: 1, age: 30, deferred: 80, free: 80, taxable: 20, isLocked: true },
    { id: 1, age: 40, deferred: 30, free: 20, taxable: 50, isLocked: true },
    { id: 1, age: 40, deferred: 10, free: 10, taxable: 80 },
    { id: 2, age: 50.4, deferred: Infinity, free: -4, taxable: 100 }
]);
check('phase normalization restores all invariants', phaseInvariant(FireStore.get().phases, 30));
check('over-100 split is clamped',
    FireStore.get().phases[0].deferred === 80 && FireStore.get().phases[0].free === 20 &&
    FireStore.get().phases[0].taxable === 0);
const locked = FireStore.get().phases[0];
const beforeLocked = JSON.stringify(locked);
FireStore.removePhase(locked.id);
FireStore.updatePhase(locked.id, 'age', 60);
check('locked phase cannot be removed or moved', JSON.stringify(FireStore.get().phases[0]) === beforeLocked);

FireStore.reset();
FireStore.setInput('drawTaxableStd', 30);
const draw = FireStore.get().inputs;
check('single draw edit preserves requested share and exact total',
    approx(draw.drawTaxableStd, 30) && approx(draw.drawDeferredStd, 35) &&
    approx(draw.drawFreeStd, 35) && approx(draw.drawTaxableStd + draw.drawDeferredStd + draw.drawFreeStd, 100));

let notifications = 0;
const unsubscribe = FireStore.subscribe(() => { notifications++; });
const beforeBatch = notifications;
FireStore.setInputs({ income: 100000, expenses: 50000, savingsRate: 80, maxSavingsRate: 50 });
check('setInputs applies a patch atomically',
    FireStore.get().inputs.income === 100000 && FireStore.get().inputs.expenses === 50000 &&
    FireStore.get().inputs.savingsRate === 50 && notifications === beforeBatch + 1);
const beforeInvalid = notifications;
check('non-finite single update is rejected', FireStore.setInput('income', Infinity) === false);
check('rejected update does not notify', notifications === beforeInvalid && FireStore.get().inputs.income === 100000);
FireStore.setInput('mcSims', 50.1);
check('simulation count is stored as an integer', FireStore.get().inputs.mcSims === 50);
unsubscribe();

const persisted = JSON.parse(memory.fireData_v3);
check('normalized batch is persisted',
    persisted.inputs.income === 100000 && persisted.inputs.savingsRate === 50 && Number.isInteger(persisted.inputs.mcSims));
FireStore.reset();
check('reset restores default state', FireStore.isDefault());

process.exit(failures ? 1 : 0);
