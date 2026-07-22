require('../js/engine.js');
const E = globalThis.FireEngine;

let failures = 0;
function check(name, condition, detail) {
    if (condition) console.log('ok:   ' + name);
    else {
        failures++;
        console.log('FAIL: ' + name + (detail ? ' — ' + detail : ''));
    }
}
function approx(actual, expected, tolerance = 1e-6) {
    return Math.abs(actual - expected) <= tolerance;
}
function finiteResult(result) {
    return result.rows.every(row => [row.deferred, row.free, row.taxable, row.total, row.expenses]
        .every(Number.isFinite));
}

const DEMO = Object.assign({}, E.DEFAULTS, {
    income: 120000,
    expenses: 60000,
    balDeferred: 150000,
    balFree: 40000,
    balTaxable: 25000,
    mcSims: 100
});

const blank = E.simulate({}, null, { startYear: 2026 });
check('blank plan spans current age through 95', blank.rows.length === 66);
check('blank plan remains finite', finiteResult(blank));
check('blank plan has no depletion', blank.summary.ranOutOfMoneyAge === null);

const normalized = E.normalizeInputs({
    currentAge: 110,
    income: -1,
    expenses: Infinity,
    savingsRate: 75,
    maxSavingsRate: 50,
    taxTaxableRate: -20,
    swr: 0,
    marketReturn: -150,
    mcSims: 50.5
});
check('input domains clamp unsafe values',
    normalized.currentAge === 95 && normalized.income === 0 && normalized.expenses === E.DEFAULTS.expenses &&
    normalized.savingsRate === 50 && normalized.taxTaxableRate === 0 && normalized.swr === 0.1 &&
    normalized.marketReturn === -99 && normalized.mcSims === 51);
check('draw sets normalize to exactly 100', E.DRAW_SETS.every(keys =>
    approx(keys.reduce((sum, key) => sum + normalized[key], 0), 100)));

const oldAge = E.simulate(Object.assign({}, DEMO, { currentAge: 97 }), null, {});
const oldAgeMc = E.monteCarlo(Object.assign({}, DEMO, { currentAge: 97, mcSims: 50 }), null, { seed: 1 });
check('age beyond horizon is handled defensively', oldAge.rows.length === 1 && oldAge.rows[0].age === 95);
check('old-age Monte Carlo stays well shaped', oldAgeMc.bands.ages.length === 1 && oldAgeMc.bands.ages[0] === 95);

const drawBase = Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 30, standardRetireAge: 30,
    marketReturn: 0, inflation: 0, expenses: 100,
    balDeferred: 1000, balFree: 1000, balTaxable: 1000,
    taxDeferredRate: 0, taxTaxableRate: 0, earlyPenaltyRate: 0
});
const overdraw = E.simulate(Object.assign({}, drawBase, {
    drawTaxableStd: 110, drawDeferredStd: 0, drawFreeStd: 0
}), null, {});
check('over-100 draw mix cannot overdraw spending', approx(overdraw.rows[0].wd.net, 100));
const decimalDraw = E.simulate(Object.assign({}, drawBase, {
    drawTaxableStd: 33.9, drawDeferredStd: 33.9, drawFreeStd: 34.2
}), null, {});
check('decimal draw mix meets need once', approx(decimalDraw.rows[0].wd.net, 100));
check('draws are never negative', decimalDraw.rows[0].wd.taxable >= 0 && decimalDraw.rows[0].wd.deferred >= 0 && decimalDraw.rows[0].wd.free >= 0);

const infeasible = E.simulate(Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 60, standardRetireAge: 60,
    income: 100000, incomeTaxRate: 25, expenses: 70000,
    savingsRate: 80, savingsRateIncrease: 0, maxSavingsRate: 80,
    incomeGrowth: 0, marketReturn: 0, inflation: 0, employerMatchRate: 0
}), [{ age: 30, deferred: 50, free: 50, taxable: 0 }], {});
const infeasibleRow = infeasible.rows[0];
check('infeasible request is flagged', infeasible.summary.firstInfeasibleAge === 30);
check('infeasible saving is capped to take-home surplus',
    approx(infeasibleRow.contrib.deferred + infeasibleRow.contrib.free + infeasibleRow.contrib.taxable, 5000));
check('row reports the savings rate actually used', approx(infeasibleRow.savingsRate, 0.05));

const cappedRate = E.simulate(Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 32, standardRetireAge: 32,
    income: 100000, incomeTaxRate: 0, expenses: 0,
    savingsRate: 75, maxSavingsRate: 50, savingsRateIncrease: 0,
    incomeGrowth: 0, marketReturn: 0, inflation: 0, employerMatchRate: 0
}), [{ age: 30, deferred: 0, free: 0, taxable: 100 }], {});
check('starting savings rate obeys its cap', approx(cappedRate.rows[0].contrib.taxable, 50000));
check('cap is reflected in the row', approx(cappedRate.rows[0].savingsRate, 0.5));

const rampedRate = E.simulate(Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 32, standardRetireAge: 32,
    income: 100000, incomeTaxRate: 0, expenses: 0,
    savingsRate: 25, maxSavingsRate: 50, savingsRateIncrease: 1,
    incomeGrowth: 0, marketReturn: 0, inflation: 0, employerMatchRate: 0
}), [{ age: 30, deferred: 0, free: 0, taxable: 100 }], {});
check('ramp rows report the rate used that year',
    approx(rampedRate.rows[0].savingsRate, 0.25) && approx(rampedRate.rows[1].savingsRate, 0.26));

function vehiclePlan(split) {
    return E.simulate(Object.assign({}, E.DEFAULTS, {
        currentAge: 30, retireAge: 31, standardRetireAge: 31,
        income: 200000, incomeTaxRate: 0, expenses: 0,
        savingsRate: 20, savingsRateIncrease: 0, maxSavingsRate: 20,
        incomeGrowth: 0, marketReturn: 0, inflation: 0,
        employerMatchRate: 50, employerMatchCap: 6
    }), [Object.assign({ age: 30 }, split)], {});
}
const mixedVehicle = vehiclePlan({ deferred: 50, free: 50, taxable: 0 }).rows[0].contrib;
check('401k and IRA caps are shared across tax treatments',
    approx(mixedVehicle.workplace, 24500) && approx(mixedVehicle.ira, 7500) &&
    approx(mixedVehicle.deferred, 16000) && approx(mixedVehicle.free, 16000) &&
    approx(mixedVehicle.taxable, 8000));
check('employee contribution dollars are conserved',
    approx(mixedVehicle.deferred + mixedVehicle.free + mixedVehicle.taxable, 40000));
check('match is based on workplace contributions', approx(mixedVehicle.match, 6000));

const rothVehicle = vehiclePlan({ deferred: 0, free: 100, taxable: 0 }).rows[0].contrib;
check('Roth workplace contributions earn match',
    approx(rothVehicle.free, 32000) && approx(rothVehicle.match, 6000) && approx(rothVehicle.deferred, 0));
const deferredVehicle = vehiclePlan({ deferred: 100, free: 0, taxable: 0 }).rows[0].contrib;
check('traditional IRA capacity follows the workplace limit',
    approx(deferredVehicle.deferred, 32000) && approx(deferredVehicle.taxable, 8000));

const catchups = E.simulate(Object.assign({}, E.DEFAULTS, {
    currentAge: 60, retireAge: 70, standardRetireAge: 70,
    income: 400000, incomeTaxRate: 0, expenses: 0,
    savingsRate: 20, savingsRateIncrease: 0, maxSavingsRate: 20,
    incomeGrowth: 0, marketReturn: 0, inflation: 3, employerMatchRate: 0
}), [{ age: 60, deferred: 100, free: 0, taxable: 0 }], {});
check('super catch-up and IRA catch-up combine at 60',
    approx(catchups.rows[0].contrib.workplace, 24500 + 11250) &&
    approx(catchups.rows[0].contrib.ira, 7500 + 1100));
const factor64 = Math.pow(1.03, 4);
check('regular catch-up resumes at 64',
    approx(catchups.rows[4].contrib.workplace, (24500 + 8000) * factor64) &&
    approx(catchups.rows[4].contrib.ira, (7500 + 1100) * factor64));

const coastInputs = Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 60, standardRetireAge: 60,
    income: 0, expenses: 60000, inflation: 3, marketReturn: 7, swr: 4,
    employerMatchRate: 0, taxDeferredRate: 15
});
const coastNumber = E.simulate(coastInputs, null, {}).summary.coastNumber;
const rothCoast = E.simulate(Object.assign({}, coastInputs, { balFree: coastNumber }), null, {});
const deferredCoast = E.simulate(Object.assign({}, coastInputs, { balDeferred: coastNumber / 0.85 }), null, {});
check('coast number reaches exactly 100% in Roth', approx(rothCoast.summary.standardCoverage, 100, 1e-8));
check('tax-adjusted deferred coast balance reaches 100%', approx(deferredCoast.summary.standardCoverage, 100, 1e-8));
check('coast readiness is measured before the first retirement flow',
    approx(rothCoast.summary.netWorthAtRetirement, coastNumber * Math.pow(1.07, 30), 0.01));

const immediate = E.simulate(Object.assign({}, coastInputs, {
    currentAge: 60, retireAge: 60, standardRetireAge: 60,
    inflation: 0, balFree: 1500000
}), null, {});
check('immediate retirement snapshot uses starting balances', approx(immediate.summary.netWorthAtRetirement, 1500000));

const futurePhase = E.simulate(Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 41, standardRetireAge: 41,
    income: 100000, incomeTaxRate: 0, expenses: 0,
    savingsRate: 10, savingsRateIncrease: 0, maxSavingsRate: 10,
    incomeGrowth: 0, marketReturn: 0, inflation: 0, employerMatchRate: 0,
    limit401k: 1e9, limitIRA: 1e9
}), [{ age: 40, deferred: 0, free: 0, taxable: 100 }], {});
check('a future-only phase does not apply early',
    approx(futurePhase.rows[0].contrib.deferred, 5000) && approx(futurePhase.rows[0].contrib.free, 5000));
check('future phase applies at its stated age', approx(futurePhase.rows[10].contrib.taxable, 10000));

const regressionPhases = [{ id: 1, age: 30, deferred: 50, free: 50, taxable: 0 }];
const bridgeBase = E.simulate(DEMO, regressionPhases, {});
const fundedBridge = E.simulate(DEMO, [
    { id: 1, age: 30, deferred: 20, free: 20, taxable: 60 }
], {});
check('an underfunded taxable bridge is reported during the bridge window',
    bridgeBase.summary.bridgeFailureAge >= DEMO.retireAge &&
    bridgeBase.summary.bridgeFailureAge < DEMO.standardRetireAge);
check('taxable-heavy saving can fund the bridge', fundedBridge.summary.bridgeFailureAge === null);

const noMatch = E.simulate(Object.assign({}, DEMO, { employerMatchRate: 0 }), regressionPhases, {});
check('employer match increases retirement net worth',
    bridgeBase.summary.netWorthAtRetirement > noMatch.summary.netWorthAtRetirement);
check('employer match is tracked', bridgeBase.summary.totalMatch > 0 && noMatch.summary.totalMatch === 0);

const highWithdrawalTax = E.simulate(Object.assign({}, DEMO, {
    taxDeferredRate: 40,
    taxTaxableRate: 30
}), regressionPhases, {});
check('higher withdrawal taxes lower ending net worth',
    highWithdrawalTax.summary.endingNetWorth < bridgeBase.summary.endingNetWorth);
check('higher withdrawal taxes increase tracked taxes',
    highWithdrawalTax.summary.totalTaxes > bridgeBase.summary.totalTaxes);

const deferredBridgeDraw = {
    drawTaxableBridge: 0,
    drawDeferredBridge: 100,
    drawFreeBridge: 0
};
const withPenalty = E.simulate(Object.assign({}, DEMO, deferredBridgeDraw), regressionPhases, {});
const withoutPenalty = E.simulate(Object.assign({}, DEMO, deferredBridgeDraw, {
    earlyPenaltyRate: 0
}), regressionPhases, {});
const firstDeferredBridge = withPenalty.rows.find(row =>
    row.phase === 'bridge' && row.wd.deferred > 0 && row.wd.taxable === 0);
const firstDeferredStandard = withPenalty.rows.find(row =>
    row.phase === 'standard' && row.wd.deferred > 0);
check('early penalty raises bridge taxes',
    withPenalty.summary.totalTaxes > withoutPenalty.summary.totalTaxes);
check('early penalty lowers ending net worth',
    withPenalty.summary.endingNetWorth < withoutPenalty.summary.endingNetWorth);
check('bridge deferred draws pay deferred tax plus the early penalty',
    firstDeferredBridge && approx(firstDeferredBridge.wd.taxes / firstDeferredBridge.wd.deferred, 0.25));
check('standard-age deferred draws do not pay the early penalty',
    firstDeferredStandard && firstDeferredStandard.wd.taxes < firstDeferredStandard.wd.deferred * 0.25);

const withoutCash = E.simulate(DEMO, regressionPhases, {});
const withCash = E.simulate(Object.assign({}, DEMO, { balCash: 50000 }), regressionPhases, {});
check('cash is constant and excluded from market growth and withdrawals',
    withCash.rows.every((row, index) => row.cash === 50000 &&
        approx(row.total - withoutCash.rows[index].total, 50000)));
check('cash is included in retirement and ending net worth',
    approx(withCash.summary.netWorthAtRetirement - withoutCash.summary.netWorthAtRetirement, 50000) &&
    approx(withCash.summary.endingNetWorth - withoutCash.summary.endingNetWorth, 50000));
check('cash does not change standard account coverage',
    approx(withCash.summary.standardCoverage, withoutCash.summary.standardCoverage));
const cashOnlyRetirement = E.simulate(Object.assign({}, E.DEFAULTS, {
    currentAge: 50, retireAge: 50, standardRetireAge: 60,
    expenses: 10000, balCash: 1000000, marketReturn: 0, inflation: 0
}), null, {});
check('inert cash cannot rescue an empty retirement portfolio',
    cashOnlyRetirement.summary.ranOutOfMoneyAge === 50 && cashOnlyRetirement.rows[0].cash === 1000000);

const years = E.MAX_AGE - DEMO.currentAge + 1;
const returns = new Float64Array(years);
for (let i = 0; i < years; i++) returns[i] = 0.02 + i * 0.0005;
const full = E.simulate(DEMO, null, { returns });
const totals = new Float64Array(years);
const lean = E.simulate(DEMO, null, { returns, lean: true, totalsOut: totals });
check('lean mode matches full totals', full.rows.every((row, i) => approx(row.total, totals[i])));
check('lean mode matches summary', approx(full.summary.endingNetWorth, lean.summary.endingNetWorth));

const fractionalMc = E.monteCarlo(Object.assign({}, DEMO, { mcSims: 50.1 }), null, { seed: 9 });
check('Monte Carlo simulation count is integral', fractionalMc.sims === 50);
check('Monte Carlo success is a probability', fractionalMc.successRate >= 0 && fractionalMc.successRate <= 1);
check('Monte Carlo bands stay ordered', fractionalMc.bands.p10.every((v, i) =>
    v <= fractionalMc.bands.p50[i] && fractionalMc.bands.p50[i] <= fractionalMc.bands.p90[i]));

const calibrated = E.monteCarlo(Object.assign({}, DEMO, {
    marketReturn: 7, volatility: 40, mcSims: 50
}), null, { seed: 11 });
const model = calibrated.returnModel;
const impliedMean = Math.exp(model.logMean + model.logStandardDeviation ** 2 / 2) - 1;
const impliedVariance = (Math.exp(model.logStandardDeviation ** 2) - 1) *
    Math.exp(2 * model.logMean + model.logStandardDeviation ** 2);
check('lognormal calibration preserves arithmetic mean', approx(impliedMean, 0.07, 1e-12));
check('lognormal calibration preserves arithmetic volatility', approx(Math.sqrt(impliedVariance), 0.40, 1e-12));

const zeroVolInputs = Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 95, standardRetireAge: 95,
    income: 0, expenses: 0, balFree: 100000,
    marketReturn: 7, volatility: 0, mcSims: 50
});
const deterministicEnd = E.simulate(zeroVolInputs, null, {}).summary.endingNetWorth;
const zeroVolMc = E.monteCarlo(zeroVolInputs, null, { seed: 1 });
check('zero-volatility Monte Carlo equals fixed projection', approx(zeroVolMc.endBalance.p50, deterministicEnd, 1e-5));
const repeatMc = E.monteCarlo(Object.assign({}, DEMO, { mcSims: 50 }), null, { seed: 42 });
const repeatMc2 = E.monteCarlo(Object.assign({}, DEMO, { mcSims: 50 }), null, { seed: 42 });
check('Monte Carlo is deterministic for a seed',
    repeatMc.successRate === repeatMc2.successRate && approx(repeatMc.endBalance.p50, repeatMc2.endBalance.p50));

process.exit(failures ? 1 : 0);
