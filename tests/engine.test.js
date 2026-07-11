require('C:/source/FIRE-CALCULATOR/js/engine.js');
const E = globalThis.FireEngine;

let failures = 0;
function check(name, cond, detail) {
    if (!cond) { failures++; console.log('FAIL: ' + name + (detail ? ' — ' + detail : '')); }
    else console.log('ok:   ' + name);
}

// 1. Defaults run
const base = E.simulate({}, null, { startYear: 2026 });
check('rows span currentAge..95', base.rows.length === 95 - 30 + 1);
// Default plan underfunds the brokerage bridge (0% taxable contributions in
// phase 1) — failure between retireAge and standardRetireAge is the correct read.
check('bridge failure lands inside bridge window if present',
    base.summary.bridgeFailureAge === null ||
    (base.summary.bridgeFailureAge >= 50 && base.summary.bridgeFailureAge < 60),
    'failAge=' + base.summary.bridgeFailureAge);
const taxHeavy = E.simulate({}, [{ id: 1, age: 30, deferred: 20, free: 20, taxable: 60 }], {});
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

const legacyInputs = Object.assign({}, E.DEFAULTS, {
    employerMatchRate: 0, employerMatchCap: 0,
    limit401k: 1e9, limitIRA: 1e9, catchUp401k: 0, catchUpIRA: 0,
    taxDeferredRate: 0, taxTaxableRate: 0
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
const withMatch = E.simulate({}, phases, {});
const noMatch = E.simulate(Object.assign({}, E.DEFAULTS, { employerMatchRate: 0 }), phases, {});
check('employer match increases retirement NW', withMatch.summary.netWorthAtRetirement > noMatch.summary.netWorthAtRetirement);
check('match total positive', withMatch.summary.totalMatch > 0, '=' + Math.round(withMatch.summary.totalMatch));

const highTax = E.simulate(Object.assign({}, E.DEFAULTS, { taxDeferredRate: 40, taxTaxableRate: 30 }), phases, {});
check('higher taxes lower ending NW', highTax.summary.endingNetWorth < withMatch.summary.endingNetWorth);
check('taxes tracked', highTax.summary.totalTaxes > withMatch.summary.totalTaxes);

// Contribution limits: someone saving 50% of 400k into deferred should hit the cap
const capped = E.simulate(Object.assign({}, E.DEFAULTS, { income: 400000, savingsRate: 50 }), [{ id: 1, age: 30, deferred: 100, free: 0, taxable: 0 }], {});
const row0 = capped.rows[0];
check('401k limit enforced year 1', Math.abs(row0.contrib.deferred - 23500) < 1, '=' + row0.contrib.deferred);
check('overflow spills to taxable', row0.contrib.taxable > 150000, '=' + Math.round(row0.contrib.taxable));

// 3b. Lean mode (Monte Carlo fast path) must match the full run exactly
{
    const years = 95 - 30 + 1;
    const R = new Float64Array(years);
    for (let i = 0; i < years; i++) R[i] = 0.03 + 0.001 * i; // varied returns
    const full = E.simulate(E.DEFAULTS, phases, { returns: R });
    const totals = new Float64Array(years);
    const lean = E.simulate(E.DEFAULTS, phases, { returns: R, lean: true, totalsOut: totals });
    let leanDiff = 0;
    for (let i = 0; i < years; i++) leanDiff = Math.max(leanDiff, Math.abs(full.rows[i].total - totals[i]));
    check('lean totals match full run', leanDiff < 1e-6, 'maxDiff=' + leanDiff);
    check('lean summary matches (ranOut)', lean.summary.ranOutOfMoneyAge === full.summary.ranOutOfMoneyAge);
    check('lean summary matches (ending NW)', Math.abs(lean.summary.endingNetWorth - full.summary.endingNetWorth) < 1e-6);
    check('lean summary matches (bridge)', lean.summary.bridgeFailureAge === full.summary.bridgeFailureAge);
    check('lean skips row building', lean.rows === null && full.rows.length === years);
}

// 4. Monte Carlo
const mc = E.monteCarlo(E.DEFAULTS, phases, { seed: 42 });
check('MC success rate in (0,1]', mc.successRate > 0 && mc.successRate <= 1, '=' + mc.successRate);
check('MC bands ordered p10<=p50<=p90', mc.bands.p10.every((v, i) => v <= mc.bands.p50[i] + 1 && mc.bands.p50[i] <= mc.bands.p90[i] + 1));
const mc2 = E.monteCarlo(E.DEFAULTS, phases, { seed: 42 });
check('MC deterministic for same seed', mc.successRate === mc2.successRate);
const mc3 = E.monteCarlo(Object.assign({}, E.DEFAULTS, { volatility: 40 }), phases, { seed: 42 });
check('higher volatility lowers success', mc3.successRate <= mc.successRate, mc3.successRate + ' vs ' + mc.successRate);

console.log('\nDefault plan: NW@50=' + Math.round(base.summary.netWorthAtRetirement / 1000) + 'k, FI#=' + Math.round(base.summary.fiNumber / 1000) + 'k, coverage=' + base.summary.standardCoverage.toFixed(0) + '%, MC success=' + (mc.successRate * 100).toFixed(0) + '%');
process.exit(failures ? 1 : 0);
