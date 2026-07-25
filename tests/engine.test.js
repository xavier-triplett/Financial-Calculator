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
    planType: E.PLAN_TYPES.EARLY,
    retireAge: 50,
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
    rothContributionBasis: -50,
    swr: 0,
    marketReturn: -150,
    mcSims: 50.5
});
check('input domains clamp unsafe values',
    normalized.currentAge === 95 && normalized.income === 0 && normalized.expenses === E.DEFAULTS.expenses &&
    normalized.savingsRate === 50 && normalized.taxTaxableRate === 0 && normalized.swr === 0.1 &&
    normalized.rothContributionBasis === 0 && normalized.marketReturn === -99 && normalized.mcSims === 51);
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
const infeasibleExpected = 5000 / (1 - 0.25 * 0.5);
check('infeasible request is flagged', infeasible.summary.firstInfeasibleAge === 30);
check('deferred tax savings increase the feasible contribution',
    approx(infeasibleRow.contrib.deferred + infeasibleRow.contrib.free + infeasibleRow.contrib.taxable, infeasibleExpected));
check('row reports the tax-adjusted savings rate actually used',
    approx(infeasibleRow.savingsRate, infeasibleExpected / 100000));
check('deferred contribution tax benefit is exposed and conserved',
    approx(infeasibleRow.contrib.taxBenefit, infeasibleRow.contrib.deferred * 0.25) &&
    approx(infeasible.summary.totalContributionTaxBenefit,
        infeasible.rows.reduce((sum, row) => sum + row.contrib.taxBenefit, 0)));

const infeasibleRoth = E.simulate(Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 31, standardRetireAge: 31,
    income: 100000, incomeTaxRate: 25, expenses: 70000,
    savingsRate: 80, savingsRateIncrease: 0, maxSavingsRate: 80,
    incomeGrowth: 0, marketReturn: 0, inflation: 0, employerMatchRate: 0
}), [{ age: 30, deferred: 0, free: 100, taxable: 0 }], {});
check('Roth contributions receive no current deferred-tax benefit',
    approx(infeasibleRoth.rows[0].contrib.free, 5000) &&
    infeasibleRoth.rows[0].contrib.taxBenefit === 0);

const cappedDeferredBenefit = E.simulate(Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 31, standardRetireAge: 31,
    income: 100000, incomeTaxRate: 25, expenses: 45000,
    savingsRate: 80, savingsRateIncrease: 0, maxSavingsRate: 80,
    incomeGrowth: 0, marketReturn: 0, inflation: 0, employerMatchRate: 0
}), [{ age: 30, deferred: 100, free: 0, taxable: 0 }], {}).rows[0];
check('deferred tax benefit stops at tax-advantaged contribution limits',
    approx(cappedDeferredBenefit.contrib.deferred, 32000) &&
    approx(cappedDeferredBenefit.contrib.taxable, 6000) &&
    approx(cappedDeferredBenefit.contrib.taxBenefit, 8000));

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

const rothVehicleRow = vehiclePlan({ deferred: 0, free: 100, taxable: 0 }).rows[0];
const rothVehicle = rothVehicleRow.contrib;
check('Roth workplace contributions earn match',
    approx(rothVehicle.free, 32000) && approx(rothVehicle.match, 6000) && approx(rothVehicle.deferred, 0));
check('only Roth IRA contributions add accessible contribution basis',
    approx(rothVehicle.rothBasisAdded, 7500) &&
    approx(rothVehicleRow.rothContributionBasis, 7500));

const workplaceOnlyRoth = E.simulate(Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 31, standardRetireAge: 60,
    income: 200000, incomeTaxRate: 0, expenses: 0,
    savingsRate: 10, savingsRateIncrease: 0, maxSavingsRate: 10,
    incomeGrowth: 0, marketReturn: 0, inflation: 0, employerMatchRate: 0
}), [{ age: 30, deferred: 0, free: 100, taxable: 0 }], {}).rows[0];
check('workplace Roth contributions do not add accessible basis',
    approx(workplaceOnlyRoth.contrib.free, 20000) &&
    workplaceOnlyRoth.contrib.rothBasisAdded === 0 &&
    workplaceOnlyRoth.rothContributionBasis === 0);

const deferredVehicle = vehiclePlan({ deferred: 100, free: 0, taxable: 0 }).rows[0].contrib;
check('traditional IRA capacity follows the workplace limit',
    approx(deferredVehicle.deferred, 32000) && approx(deferredVehicle.taxable, 8000));

const catchups = E.simulate(Object.assign({}, E.DEFAULTS, {
    planType: E.PLAN_TYPES.TRADITIONAL,
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

const spendableInputs = Object.assign({}, E.DEFAULTS, {
    balDeferred: 1000, balFree: 500, balTaxable: 1000,
    balCash: 10000, taxDeferredRate: 25, taxTaxableRate: 10
});
check('canonical spendable-assets helper tax-adjusts investments and excludes cash',
    approx(E.spendableAssets(spendableInputs), 2150) &&
    approx(E.spendableAssets(spendableInputs, {
        deferred: 2000, free: 250, taxable: 500
    }), 2200));

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

const coastPathInputs = Object.assign({}, E.DEFAULTS, {
    planType: E.PLAN_TYPES.COAST,
    currentAge: 30, coastAge: 32, retireAge: 35, standardRetireAge: 35,
    income: 100000, incomeTaxRate: 0, expenses: 0,
    savingsRate: 10, savingsRateIncrease: 0, maxSavingsRate: 10,
    incomeGrowth: 0, marketReturn: 0, inflation: 0, employerMatchRate: 0,
    limit401k: 1e9, limitIRA: 1e9
});
const coastPath = E.simulate(coastPathInputs, null, {});
const traditionalPath = E.simulate(Object.assign({}, coastPathInputs, {
    planType: E.PLAN_TYPES.TRADITIONAL
}), null, {});
check('Coast FIRE contributes only before the coast age',
    approx(coastPath.summary.totalContributed, 20000) &&
    coastPath.rows.filter(row => row.age >= 32 && row.age < 35).every(row =>
        row.phase === 'coasting' && row.savingsRate === 0 &&
        row.contrib.deferred + row.contrib.free + row.contrib.taxable === 0));
check('traditional retirement keeps contributing through working years',
    approx(traditionalPath.summary.totalContributed, 50000) &&
    traditionalPath.rows.filter(row => row.age < 35).every(row => row.phase === 'working'));
check('coast checkpoint captures the balance when contributions stop',
    coastPath.summary.coastStartAge === 32 && approx(coastPath.summary.coastBalanceAtStart, 18500));

const laterTraditional = E.simulate(Object.assign({}, coastPathInputs, {
    planType: E.PLAN_TYPES.TRADITIONAL, retireAge: 67, standardRetireAge: 60
}), null, {});
check('retirement readiness waits for a later traditional retirement age',
    laterTraditional.summary.readinessAge === 67);
const brokerageRetirement = E.simulate(Object.assign({}, E.DEFAULTS, {
    planType: E.PLAN_TYPES.TRADITIONAL,
    currentAge: 30, retireAge: 31, standardRetireAge: 31,
    income: 0, expenses: 4000, inflation: 0, marketReturn: 0, swr: 4,
    balTaxable: 100000 / 0.9, employerMatchRate: 0
}), null, {});
check('traditional readiness counts the whole after-tax portfolio',
    approx(brokerageRetirement.summary.retirementCoverageAtReadiness, 100) &&
    brokerageRetirement.summary.standardCoverage === 0);

const futurePhase = E.simulate(Object.assign({}, E.DEFAULTS, {
    planType: E.PLAN_TYPES.TRADITIONAL,
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

const rothBasisBridgeInputs = Object.assign({}, E.DEFAULTS, {
    currentAge: 40, retireAge: 40, standardRetireAge: 60,
    expenses: 100, balDeferred: 0, balFree: 1000, balTaxable: 0,
    rothContributionBasis: 250,
    marketReturn: 0, inflation: 0,
    taxDeferredRate: 0, taxTaxableRate: 0, earlyPenaltyRate: 0,
    drawTaxableBridge: 0, drawDeferredBridge: 0, drawFreeBridge: 100
});
const rothBasisBridge = E.simulate(rothBasisBridgeInputs, null, {});
check('pre-access Roth draws stop at accessible contribution basis',
    approx(rothBasisBridge.rows[0].wd.free, 100) &&
    approx(rothBasisBridge.rows[1].wd.free, 100) &&
    approx(rothBasisBridge.rows[2].wd.free, 50) &&
    rothBasisBridge.rows[3].wd.free === 0 &&
    rothBasisBridge.summary.ranOutOfMoneyAge === 42);
check('preferred Roth draws decrement basis without consuming inaccessible earnings',
    approx(rothBasisBridge.rows[0].rothContributionBasis, 150) &&
    approx(rothBasisBridge.rows[2].rothContributionBasis, 0) &&
    approx(rothBasisBridge.rows[2].free, 750));

const rothBasisFallback = E.simulate(Object.assign({}, rothBasisBridgeInputs, {
    currentAge: 40, retireAge: 40, expenses: 100,
    rothContributionBasis: 200,
    drawTaxableBridge: 100, drawDeferredBridge: 0, drawFreeBridge: 0
}), null, {});
check('fallback Roth draws obey and decrement the same basis',
    approx(rothBasisFallback.rows[0].wd.free, 100) &&
    approx(rothBasisFallback.rows[0].rothContributionBasis, 100));

const standardRoth = E.simulate(Object.assign({}, rothBasisBridgeInputs, {
    currentAge: 60, retireAge: 60, standardRetireAge: 60,
    rothContributionBasis: 0
}), null, {});
check('the full Roth balance is available at the account-access age',
    approx(standardRoth.rows[0].wd.free, 100));

const inaccessibleRothMc = E.monteCarlo(Object.assign({}, rothBasisBridgeInputs, {
    expenses: 10, volatility: 0, mcSims: 50, rothContributionBasis: 0
}), null, { seed: 17 });
const accessibleRothMc = E.monteCarlo(Object.assign({}, rothBasisBridgeInputs, {
    expenses: 10, volatility: 0, mcSims: 50, rothContributionBasis: 1000
}), null, { seed: 17 });
check('lean Monte Carlo applies the same Roth-basis access limit',
    inaccessibleRothMc.successRate === 0 && accessibleRothMc.successRate === 1);

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
check('lean mode preserves Roth contribution basis',
    approx(full.summary.endingRothContributionBasis, lean.summary.endingRothContributionBasis));

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

/* ---------------- Beginner model ---------------- */

// The whole point: a value customized in Expert mode must not survive into a
// beginner run. Every frozen key here is set to something absurd first.
const TAMPERED = Object.assign({}, E.DEFAULTS, {
    income: 120000, expenses: 48000, savingsRate: 20,
    balDeferred: 90000, balFree: 40000, rothContributionBasis: 30000,
    balTaxable: 25000, balCash: 5000,
    marketReturn: 42, inflation: 19, swr: 11, savingsRateIncrease: 9,
    maxSavingsRate: 95, incomeGrowth: 25, incomeTaxRate: 55,
    standardRetireAge: 72, taxDeferredRate: 90, taxTaxableRate: 80,
    earlyPenaltyRate: 40, limit401k: 999999, limitIRA: 999999,
    volatility: 90, mcSims: 51, employerMatchCap: 99,
    drawTaxableStd: 100, drawDeferredStd: 0, drawFreeStd: 0
});
const beg = E.beginnerInputs(TAMPERED);

check('beginner ignores customized growth', beg.marketReturn === E.BEGINNER_MODEL.marketReturn);
check('beginner ignores customized inflation', beg.inflation === 0);
check('beginner ignores customized withdrawal rate', beg.swr === 4);
check('beginner ignores customized access age', beg.standardRetireAge === 60);
check('beginner models no taxes or early penalty',
    beg.incomeTaxRate === 0 && beg.taxDeferredRate === 0 &&
    beg.taxTaxableRate === 0 && beg.earlyPenaltyRate === 0);
check('beginner ignores expert Roth contribution basis', beg.rothContributionBasis === 0);
check('beginner ignores customized contribution limits',
    beg.limit401k === E.DEFAULTS.limit401k && beg.limitIRA === E.DEFAULTS.limitIRA);
check('beginner ignores customized drawdown order',
    beg.drawTaxableStd === E.DEFAULTS.drawTaxableStd && beg.drawFreeStd === E.DEFAULTS.drawFreeStd);
check('beginner ignores customized Monte Carlo settings',
    beg.volatility === 15 && beg.mcSims === 2000);
check('beginner keeps the inputs it owns',
    beg.income === 120000 && beg.expenses === 48000 && beg.savingsRate === 20 &&
    beg.balDeferred === 90000 && beg.balCash === 5000);

// The savings rate is one number for the whole projection, not a ramp.
check('beginner savings rate never ramps', beg.savingsRateIncrease === 0);
check('beginner savings cap equals the entered rate', beg.maxSavingsRate === beg.savingsRate);

// Employer match is a yes/no answer, so the rate itself is not user-set.
check('beginner match on uses the standard rate',
    E.beginnerInputs(Object.assign({}, TAMPERED, { employerMatchRate: 3 })).employerMatchRate === 50);
check('beginner match off stays off',
    E.beginnerInputs(Object.assign({}, TAMPERED, { employerMatchRate: 0 })).employerMatchRate === 0);

check('every beginner-owned key is a real input',
    E.BEGINNER_OWNED.every(key => Object.prototype.hasOwnProperty.call(E.DEFAULTS, key)));
check('the beginner model covers every input',
    Object.keys(E.DEFAULTS).every(key => Number.isFinite(Number(E.BEGINNER_MODEL[key]))));

const begRun = E.simulate(beg, E.BEGINNER_PHASES, {});
check('beginner projection is finite', finiteResult(begRun));

// Today's dollars: spending does not drift, so the numbers stay legible.
const begExpenses = begRun.rows.map(r => r.expenses);
check('beginner spending stays in today\'s dollars',
    begExpenses.every(v => approx(v, begExpenses[0], 1e-9)));

// One rate, every working year, checked on a plan with ample take-home so
// the feasibility cap never bites.
const roomy = E.beginnerInputs(Object.assign({}, E.DEFAULTS, {
    planType: E.PLAN_TYPES.TRADITIONAL,
    income: 200000, expenses: 30000, savingsRate: 25, retireAge: 60
}));
const roomyWorking = E.simulate(roomy, E.BEGINNER_PHASES, {}).rows.filter(r => r.phase === 'working');
check('beginner saves the same share every working year',
    roomyWorking.length > 1 && roomyWorking.every(r => approx(r.savingsRate, 0.25, 1e-9)));

const beginnerTaxFreeCashflow = E.simulate(E.beginnerInputs(Object.assign({}, E.DEFAULTS, {
    currentAge: 30, retireAge: 31,
    income: 100000, expenses: 70000, savingsRate: 80
})), E.BEGINNER_PHASES, {}).rows[0];
check('beginner affordability uses tax-free income with no deferred tax credit',
    approx(beginnerTaxFreeCashflow.contrib.deferred + beginnerTaxFreeCashflow.contrib.free, 30000) &&
    beginnerTaxFreeCashflow.contrib.taxBenefit === 0);

const beginnerTaxFreeRetirement = E.simulate(E.beginnerInputs(Object.assign({}, E.DEFAULTS, {
    currentAge: 40, retireAge: 40,
    expenses: 100, balDeferred: 1000, balTaxable: 100
})), E.BEGINNER_PHASES, {});
check('beginner brokerage and early deferred withdrawals pay no modeled tax',
    approx(beginnerTaxFreeRetirement.rows[0].wd.taxable, 100) &&
    beginnerTaxFreeRetirement.rows[1].wd.deferred > 0 &&
    beginnerTaxFreeRetirement.summary.totalTaxes === 0);

/* Beginner's real rates are derived from the same nominal pair Expert runs on,
 * so with no contributions in play the two must agree exactly once the expert
 * run is deflated. This is what lets the modes claim to describe one world. */
const GROW_ONLY = {
    currentAge: 30, retireAge: 95, standardRetireAge: 95,
    income: 0, expenses: 0, balFree: 250000, savingsRate: 0
};
const nominalRun = E.simulate(Object.assign({}, E.DEFAULTS, GROW_ONLY, {
    marketReturn: E.BEGINNER_NOMINAL.marketReturn, inflation: E.BEGINNER_NOMINAL.inflation
}), E.BEGINNER_PHASES, {});
const realRun = E.simulate(E.beginnerInputs(Object.assign({}, E.DEFAULTS, GROW_ONLY)), E.BEGINNER_PHASES, {});
const deflator = Math.pow(1 + E.BEGINNER_NOMINAL.inflation / 100, realRun.summary.yearsModeled);
check('beginner real growth matches expert nominal growth, deflated',
    approx(realRun.summary.endingNetWorth, nominalRun.summary.endingNetWorth / deflator, 1e-5),
    realRun.summary.endingNetWorth + ' vs ' + nominalRun.summary.endingNetWorth / deflator);

const begAssume = E.beginnerAssumptions();
check('beginner assumptions are stated for the user',
    begAssume.length > 0 && begAssume.every(a => a.label && a.value && a.note));
const begTaxAssumption = begAssume.find(a => a.label === 'Taxes');
check('beginner assumptions explicitly state that taxes are not modeled',
    begTaxAssumption && /not modeled/i.test(begTaxAssumption.value + ' ' + begTaxAssumption.note));

process.exit(failures ? 1 : 0);
