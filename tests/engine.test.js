require('C:/source/FIRE-CALCULATOR/js/engine.js');
const E = globalThis.FireEngine;

let failures = 0;
function check(name, cond, detail) {
    if (!cond) { failures++; console.log('FAIL: ' + name + (detail ? ' — ' + detail : '')); }
    else console.log('ok:   ' + name);
}

// Shipped defaults hold no personal financial data (all dollar figures are
// zero), so the behavioral tests run against this demo plan instead.
const DEMO = Object.assign({}, E.DEFAULTS, {
    income: 120000, expenses: 60000,
    balDeferred: 150000, balFree: 40000, balTaxable: 25000
});

// 0. Zero defaults stay sane: nothing to spend means nothing ever breaks
const blank = E.simulate({}, null, { startYear: 2026 });
check('zero defaults: dollar fields are zero',
    E.DEFAULTS.income === 0 && E.DEFAULTS.expenses === 0 &&
    E.DEFAULTS.balDeferred === 0 && E.DEFAULTS.balFree === 0 && E.DEFAULTS.balTaxable === 0);
check('zero defaults: full age span', blank.rows.length === 95 - 30 + 1);
check('zero defaults: FI number is zero', blank.summary.fiNumber === 0);
check('zero defaults: never marked broke', blank.summary.ranOutOfMoneyAge === null && blank.summary.bridgeFailureAge === null);
check('zero defaults: nothing infeasible', blank.summary.firstInfeasibleAge === null);
check('zero defaults: no NaN in totals', blank.rows.every(r => Number.isFinite(r.total)));
check('zero defaults: MC succeeds trivially', E.monteCarlo({}, null, { seed: 1 }).successRate === 1);

// 1. Demo plan runs
const base = E.simulate(DEMO, null, { startYear: 2026 });
check('rows span currentAge..95', base.rows.length === 95 - 30 + 1);
// Default plan underfunds the brokerage bridge (0% taxable contributions in
// phase 1) — failure between retireAge and standardRetireAge is the correct read.
check('bridge failure lands inside bridge window if present',
    base.summary.bridgeFailureAge === null ||
    (base.summary.bridgeFailureAge >= 50 && base.summary.bridgeFailureAge < 60),
    'failAge=' + base.summary.bridgeFailureAge);
const taxHeavy = E.simulate(DEMO, [{ id: 1, age: 30, deferred: 20, free: 20, taxable: 60 }], {});
check('taxable-heavy plan secures the bridge', taxHeavy.summary.bridgeFailureAge === null,
    'failAge=' + taxHeavy.summary.bridgeFailureAge);
check('never broke with defaults', base.summary.ranOutOfMoneyAge === null);
check('NW at retirement plausible (>1M)', base.summary.netWorthAtRetirement > 1e6, '=' + Math.round(base.summary.netWorthAtRetirement));
check('FI number plausible', base.summary.fiNumber > 1e6 && base.summary.fiNumber < 1e7, '=' + Math.round(base.summary.fiNumber));

// 2. Legacy parity: disable new features -> replicate original algorithm inline
function legacySim(d, phases) {
    let curD = d.balDeferred, curF = d.balFree, curT = d.balTaxable;
    let inc = d.income, exp = d.expenses, sr = d.savingsRate / 100;
    let bridgeFail = null, broke = null;
    const rows = [];
    for (let age = d.currentAge; age <= 95; age++) {
        const isRet = age >= d.retireAge, isStd = age >= d.standardRetireAge;
        const g = d.marketReturn / 100;
        curD *= 1 + g; curF *= 1 + g; curT *= 1 + g;
        if (!isRet) {
            let ph = phases.concat().sort((a, b) => b.age - a.age).find(p => p.age <= age) || phases[0];
            const tot = inc * sr;
            curD += tot * ph.deferred / 100; curF += tot * ph.free / 100; curT += tot * ph.taxable / 100;
            if (sr < d.maxSavingsRate / 100) sr = Math.min(d.maxSavingsRate / 100, sr + d.savingsRateIncrease / 100);
            inc *= 1 + d.incomeGrowth / 100; exp *= 1 + d.inflation / 100;
        } else {
            const need = exp, tw = curD + curF + curT;
            if (tw <= 0) { if (!broke) broke = age; }
            else {
                let wT, wD, wF;
                if (!isStd) { wT = need * d.drawTaxableBridge / 100; wD = need * d.drawDeferredBridge / 100; wF = need * d.drawFreeBridge / 100; }
                else { wT = need * d.drawTaxableStd / 100; wD = need * d.drawDeferredStd / 100; wF = need * d.drawFreeStd / 100; }
                let tT = Math.min(wT, curT), tD = Math.min(wD, curD), tF = Math.min(wF, curF);
                curT -= tT; curD -= tD; curF -= tF;
                let shortfall = need - (tT + tD + tF);
                if (shortfall > 0.01) {
                    let stillNeed = shortfall, guard = 0;
                    while (stillNeed > 1 && guard < 10) {
                        const srcs = [];
                        if (curT > 0) srcs.push('t'); if (curD > 0) srcs.push('d'); if (curF > 0) srcs.push('f');
                        if (!srcs.length) break;
                        const chunk = stillNeed / srcs.length;
                        srcs.forEach(s => {
                            if (s === 't') { const t = Math.min(chunk, curT); curT -= t; stillNeed -= t; }
                            else if (s === 'd') { const t = Math.min(chunk, curD); curD -= t; stillNeed -= t; }
                            else { const t = Math.min(chunk, curF); curF -= t; stillNeed -= t; }
                        });
                        guard++;
                    }
                }
                if (!isStd && curT <= 0 && shortfall > 0.01 && bridgeFail === null) bridgeFail = age;
            }
            exp *= 1 + d.inflation / 100;
        }
        if (curD < 0) curD = 0; if (curF < 0) curF = 0; if (curT < 0) curT = 0;
        rows.push({ age, total: curD + curF + curT });
    }
    return { rows, bridgeFail, broke };
}

const legacyInputs = Object.assign({}, DEMO, {
    employerMatchRate: 0, employerMatchCap: 0,
    limit401k: 1e9, limitIRA: 1e9, catchUp401k: 0, catchUpIRA: 0,
    taxDeferredRate: 0, taxTaxableRate: 0, earlyPenaltyRate: 0
});
const phases = [{ id: 1, age: 30, deferred: 50, free: 50, taxable: 0 }];
const mine = E.simulate(legacyInputs, phases, { startYear: 2026 });
const legacy = legacySim(legacyInputs, phases);
let maxDiff = 0;
for (let i = 0; i < mine.rows.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(mine.rows[i].total - legacy.rows[i].total));
}
check('legacy parity: totals match within $1', maxDiff < 1, 'maxDiff=' + maxDiff.toFixed(2));
check('legacy parity: bridge status', (mine.summary.bridgeFailureAge === legacy.bridgeFail));

// 3. New features move numbers the right direction
const withMatch = E.simulate(DEMO, phases, {});
const noMatch = E.simulate(Object.assign({}, DEMO, { employerMatchRate: 0 }), phases, {});
check('employer match increases retirement NW', withMatch.summary.netWorthAtRetirement > noMatch.summary.netWorthAtRetirement);
check('match total positive', withMatch.summary.totalMatch > 0, '=' + Math.round(withMatch.summary.totalMatch));

const highTax = E.simulate(Object.assign({}, DEMO, { taxDeferredRate: 40, taxTaxableRate: 30 }), phases, {});
check('higher taxes lower ending NW', highTax.summary.endingNetWorth < withMatch.summary.endingNetWorth);
check('taxes tracked', highTax.summary.totalTaxes > withMatch.summary.totalTaxes);

// Contribution limits: someone saving 50% of 400k into deferred should hit the cap
const capped = E.simulate(Object.assign({}, DEMO, { income: 400000, savingsRate: 50 }), [{ id: 1, age: 30, deferred: 100, free: 0, taxable: 0 }], {});
const row0 = capped.rows[0];
check('401k limit enforced year 1', Math.abs(row0.contrib.deferred - E.DEFAULTS.limit401k) < 1, '=' + row0.contrib.deferred);
check('overflow spills to taxable', row0.contrib.taxable > 150000, '=' + Math.round(row0.contrib.taxable));

// SECURE 2.0 super catch-up: ages 60-63 get the larger 401k catch-up
const at60 = E.simulate(
    Object.assign({}, DEMO, { currentAge: 60, retireAge: 70, standardRetireAge: 70, income: 800000, savingsRate: 50 }),
    [{ id: 1, age: 60, deferred: 100, free: 0, taxable: 0 }], {});
check('super catch-up applies at 60',
    Math.abs(at60.rows[0].contrib.deferred - (E.DEFAULTS.limit401k + E.DEFAULTS.superCatchUp401k)) < 1,
    '=' + at60.rows[0].contrib.deferred);
check('regular catch-up resumes at 64',
    Math.abs(at60.rows[4].contrib.deferred - (E.DEFAULTS.limit401k + E.DEFAULTS.catchUp401k) * Math.pow(1.03, 4)) < 1,
    '=' + at60.rows[4].contrib.deferred);

// 3e. Early-withdrawal penalty on pre-access-age deferred draws
{
    const draws = { drawTaxableBridge: 0, drawDeferredBridge: 100, drawFreeBridge: 0 };
    const pen = E.simulate(Object.assign({}, DEMO, draws), phases, {});
    const noPen = E.simulate(Object.assign({}, DEMO, draws, { earlyPenaltyRate: 0 }), phases, {});
    check('early penalty raises bridge taxes', pen.summary.totalTaxes > noPen.summary.totalTaxes);
    check('early penalty lowers ending NW', pen.summary.endingNetWorth < noPen.summary.endingNetWorth);
    const firstBridge = pen.rows.find(r => r.phase === 'bridge' && r.wd.deferred > 0 && r.wd.taxable === 0);
    check('bridge deferred draw taxed at rate + penalty',
        firstBridge && Math.abs(firstBridge.wd.taxes / firstBridge.wd.deferred - 0.25) < 1e-9,
        firstBridge && String(firstBridge.wd.taxes / firstBridge.wd.deferred));
    const post = pen.rows.find(r => r.phase === 'standard' && r.wd.deferred > 0);
    check('standard-age deferred draw pays no penalty',
        post && post.wd.taxes < post.wd.deferred * 0.25);
}

// 3f. Feasibility: savings + expenses must fit inside income after tax
check('DEMO plan flags infeasible saving at 31', base.summary.firstInfeasibleAge === 31,
    '=' + base.summary.firstInfeasibleAge);
check('modest plan stays feasible',
    E.simulate(Object.assign({}, DEMO, { expenses: 30000 }), phases, {}).summary.firstInfeasibleAge === null);

// 3c. Cash on hand is inert net worth: never grown, never drawn
{
    const noCash = E.simulate(DEMO, phases, {});
    const withCash = E.simulate(Object.assign({}, DEMO, { balCash: 50000 }), phases, {});
    check('cash defaults to zero', E.DEFAULTS.balCash === 0);
    check('cash lifts every year by exactly itself (no growth, no draws)',
        withCash.rows.every((r, i) => Math.abs(r.total - noCash.rows[i].total - 50000) < 1e-6));
    check('cash constant in rows', withCash.rows.every(r => r.cash === 50000));
    check('cash in NW at retirement',
        Math.abs(withCash.summary.netWorthAtRetirement - noCash.summary.netWorthAtRetirement - 50000) < 1e-6);
    check('cash in estate', Math.abs(withCash.summary.endingNetWorth - noCash.summary.endingNetWorth - 50000) < 1e-6);
    check('cash cannot rescue a broke plan', withCash.summary.ranOutOfMoneyAge === noCash.summary.ranOutOfMoneyAge);
    check('cash does not change coverage', withCash.summary.standardCoverage === noCash.summary.standardCoverage);
}

// 3d. Already past both target ages: readiness is measured at the first
// simulated year instead of never firing
{
    const late = E.simulate(
        Object.assign({}, DEMO, { currentAge: 65, retireAge: 50, standardRetireAge: 60, balDeferred: 1500000, balFree: 500000 }),
        [{ id: 1, age: 65, deferred: 50, free: 50, taxable: 0 }], {});
    check('past-standard-age coverage computed', late.summary.standardCoverage > 0, '=' + late.summary.standardCoverage);
    check('past-standard-age well-funded plan reads secure', late.summary.standardSuccess === true);
    check('past-retire-age NW recorded', late.summary.netWorthAtRetirement > 0);
    check('past-retire-age FI number set', late.summary.fiNumber > 0);
}

// 3b. Lean mode (Monte Carlo fast path) must match the full run exactly
{
    const years = 95 - 30 + 1;
    const R = new Float64Array(years);
    for (let i = 0; i < years; i++) R[i] = 0.03 + 0.001 * i; // varied returns
    const full = E.simulate(DEMO, phases, { returns: R });
    const totals = new Float64Array(years);
    const lean = E.simulate(DEMO, phases, { returns: R, lean: true, totalsOut: totals });
    let leanDiff = 0;
    for (let i = 0; i < years; i++) leanDiff = Math.max(leanDiff, Math.abs(full.rows[i].total - totals[i]));
    check('lean totals match full run', leanDiff < 1e-6, 'maxDiff=' + leanDiff);
    check('lean summary matches (ranOut)', lean.summary.ranOutOfMoneyAge === full.summary.ranOutOfMoneyAge);
    check('lean summary matches (ending NW)', Math.abs(lean.summary.endingNetWorth - full.summary.endingNetWorth) < 1e-6);
    check('lean summary matches (bridge)', lean.summary.bridgeFailureAge === full.summary.bridgeFailureAge);
    check('lean skips row building', lean.rows === null && full.rows.length === years);
}

// 4. Monte Carlo
// Median calibration: with no cashflows, the median simulated estate should
// track the deterministic compound path (lognormal draws, median = mean input)
{
    const growOnly = Object.assign({}, E.DEFAULTS, { retireAge: 96, standardRetireAge: 96, balDeferred: 100000 });
    const det = E.simulate(growOnly, null, {}).summary.endingNetWorth;
    const mcGrow = E.monteCarlo(growOnly, null, { seed: 7 });
    check('MC median tracks deterministic growth',
        mcGrow.endBalance.p50 > det * 0.85 && mcGrow.endBalance.p50 < det * 1.15,
        'p50=' + Math.round(mcGrow.endBalance.p50) + ' det=' + Math.round(det));
}

const mc = E.monteCarlo(DEMO, phases, { seed: 42 });
check('MC success rate in (0,1]', mc.successRate > 0 && mc.successRate <= 1, '=' + mc.successRate);
check('MC bands ordered p10<=p50<=p90', mc.bands.p10.every((v, i) => v <= mc.bands.p50[i] + 1 && mc.bands.p50[i] <= mc.bands.p90[i] + 1));
const mc2 = E.monteCarlo(DEMO, phases, { seed: 42 });
check('MC deterministic for same seed', mc.successRate === mc2.successRate);
const mc3 = E.monteCarlo(Object.assign({}, DEMO, { volatility: 40 }), phases, { seed: 42 });
check('higher volatility lowers success', mc3.successRate <= mc.successRate, mc3.successRate + ' vs ' + mc.successRate);

console.log('\nDefault plan: NW@50=' + Math.round(base.summary.netWorthAtRetirement / 1000) + 'k, FI#=' + Math.round(base.summary.fiNumber / 1000) + 'k, coverage=' + base.summary.standardCoverage.toFixed(0) + '%, MC success=' + (mc.successRate * 100).toFixed(0) + '%');
process.exit(failures ? 1 : 0);
