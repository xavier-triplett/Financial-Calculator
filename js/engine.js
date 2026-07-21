/* =========================================================================
 * FireEngine — pure calculation core for the Coast FIRE three-bucket model.
 * No DOM access; attaches to window in the browser and globalThis in Node
 * so the same file can be unit-tested from the command line.
 *
 * The year loop is written allocation-free (scalar locals only) because
 * Monte Carlo runs it thousands of times per keystroke. Row objects are
 * only built for the single full run the UI displays; simulations pass
 * { lean: true } and get totals written into a preallocated typed array.
 * ========================================================================= */
(function (global) {
    'use strict';

    var MAX_AGE = 95;

    var DEFAULTS = {
        // Profile
        currentAge: 30,
        retireAge: 50,
        standardRetireAge: 60,

        // Income & savings — personal dollar figures ship as zero so a
        // signed-out visitor sees no financial data.
        income: 0,
        incomeTaxRate: 25,        // % of gross pay lost to payroll + income tax
        savingsRate: 25,          // %
        savingsRateIncrease: 1,   // % points per year
        maxSavingsRate: 50,       // %
        expenses: 0,
        incomeGrowth: 3,          // %

        // Current buckets
        balDeferred: 0,
        balFree: 0,
        balTaxable: 0,
        // Cash on hand: counts toward net worth but sits outside the market —
        // never grown by returns and never drawn by the simulation.
        balCash: 0,

        // Market assumptions
        marketReturn: 7,          // %
        inflation: 3,             // %
        swr: 4,                   // %

        // Drawdown split — bridge phase (retireAge .. standardRetireAge)
        drawTaxableBridge: 100,
        drawDeferredBridge: 0,
        drawFreeBridge: 0,

        // Drawdown split — standard phase (standardRetireAge+)
        drawTaxableStd: 20,
        drawDeferredStd: 40,
        drawFreeStd: 40,

        // Employer match: matchRate% of your 401k contributions,
        // on contributions up to matchCap% of salary.
        employerMatchRate: 50,    // %
        employerMatchCap: 6,      // % of salary

        // IRS contribution limits — 2026 statutory caps, indexed to
        // inflation in the projection. Editable so they can track the IRS.
        limit401k: 24500,
        limitIRA: 7500,
        catchUp401k: 8000,
        superCatchUp401k: 11250,  // SECURE 2.0, ages 60-63
        catchUpIRA: 1100,
        catchUpAge: 50,

        // Effective tax rates on withdrawals
        taxDeferredRate: 15,      // % — ordinary income on 401k/IRA draws
        taxTaxableRate: 10,       // % — capital gains on brokerage draws

        // Monte Carlo
        volatility: 15,           // % annual std-dev of returns
        mcSims: 2000
    };

    var DEFAULT_PHASES = [
        { id: 1, age: 30, deferred: 50, free: 50, taxable: 0, isLocked: true }
    ];

    var ZERO_CONTRIB = { deferred: 0, free: 0, taxable: 0, match: 0, overflow: 0 };

    /* ---------------------------------------------------------------------
     * Seeded RNG (mulberry32) + Box-Muller normal draw, so Monte Carlo
     * results are stable for a given plan until the user re-rolls.
     * ------------------------------------------------------------------- */
    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function makeNormal(rand) {
        var spare = null;
        return function () {
            if (spare !== null) { var s = spare; spare = null; return s; }
            var u = 0, v = 0;
            while (u === 0) u = rand();
            while (v === 0) v = rand();
            var mag = Math.sqrt(-2.0 * Math.log(u));
            spare = mag * Math.sin(2.0 * Math.PI * v);
            return mag * Math.cos(2.0 * Math.PI * v);
        };
    }

    function pct(v) { return (Number(v) || 0) / 100; }
    function num(v) { return Number(v) || 0; }

    /* ---------------------------------------------------------------------
     * simulate(inputs, phases, options)
     *   options.returns   — optional per-year return rates (decimal array),
     *                       used by Monte Carlo; defaults to fixed marketReturn.
     *   options.startYear — calendar year of the first row.
     *   options.lean      — skip building per-year row objects (Monte Carlo).
     *   options.totalsOut — Float64Array to receive total net worth per year.
     * Returns { rows: [...] | null, summary: {...} }
     * ------------------------------------------------------------------- */
    function simulate(inputs, phases, options) {
        options = options || {};
        var d = {};
        for (var k in DEFAULTS) d[k] = (inputs && inputs[k] !== undefined) ? num(inputs[k]) : DEFAULTS[k];

        var phaseList = (phases && phases.length ? phases : DEFAULT_PHASES)
            .slice()
            .sort(function (a, b) { return a.age - b.age; });
        var phaseCount = phaseList.length;

        var lean = !!options.lean;
        var returns = options.returns || null;
        var totalsOut = options.totalsOut || null;
        var startYear = options.startYear || 2026;

        var growth = pct(d.marketReturn);
        var inflation = pct(d.inflation);
        var incomeGrowth = pct(d.incomeGrowth);
        var swr = pct(d.swr);

        var taxD = Math.min(0.99, pct(d.taxDeferredRate));
        var taxT = Math.min(0.99, pct(d.taxTaxableRate));
        var keepD = 1 - taxD;                 // net kept per gross dollar drawn
        var keepT = 1 - taxT;

        var drawTB = pct(d.drawTaxableBridge), drawDB = pct(d.drawDeferredBridge), drawFB = pct(d.drawFreeBridge);
        var drawTS = pct(d.drawTaxableStd), drawDS = pct(d.drawDeferredStd), drawFS = pct(d.drawFreeStd);

        var matchCap = pct(d.employerMatchCap);
        var matchRate = pct(d.employerMatchRate);

        var curDeferred = d.balDeferred;
        var curFree = d.balFree;
        var curTaxable = d.balTaxable;
        var cash = d.balCash; // inert: no growth, no draws
        var curIncome = d.income;
        var curExpenses = d.expenses;
        var curSavingsRate = pct(d.savingsRate);
        var maxSavingsRate = pct(d.maxSavingsRate);
        var savingsRateStep = pct(d.savingsRateIncrease);

        var rows = lean ? null : [];
        var bridgeFailureAge = null;
        var ranOutOfMoneyAge = null;
        var standardSuccess = false;
        var standardCoverage = 0;
        var netWorthAtRetirement = 0;
        var expensesAtRetirement = 0;
        var totalTaxes = 0;
        var totalMatch = 0;
        var totalContributed = 0;

        var inflFactor = 1; // (1 + inflation)^yearIndex, updated incrementally

        for (var age = d.currentAge; age <= MAX_AGE; age++) {
            var yearIndex = age - d.currentAge;
            var isRetired = age >= d.retireAge;
            var isStandardAge = age >= d.standardRetireAge;

            // 1. Market growth (original model grows balances before flows)
            var r = returns ? returns[yearIndex] : growth;
            curDeferred *= (1 + r);
            curFree *= (1 + r);
            curTaxable *= (1 + r);

            var contrib = ZERO_CONTRIB;
            var wdGross = 0, wdNet = 0, wdTaxes = 0, wdT = 0, wdD = 0, wdF = 0;
            var g;

            if (!isRetired) {
                /* ---------------- WORKING YEARS ---------------- */
                var activePhase = phaseList[0];
                for (var p = phaseCount - 1; p >= 0; p--) {
                    if (phaseList[p].age <= age) { activePhase = phaseList[p]; break; }
                }

                var totalSavings = curIncome * curSavingsRate;
                var wantD = totalSavings * pct(activePhase.deferred);
                var wantF = totalSavings * pct(activePhase.free);
                var wantT = totalSavings * pct(activePhase.taxable);

                // IRS limits, indexed to inflation, with catch-up at 50+.
                // SECURE 2.0: ages 60-63 use the larger 401k super catch-up.
                var catchUpEligible = age >= d.catchUpAge;
                var catchUp401 = age >= 60 && age <= 63 ? d.superCatchUp401k : (catchUpEligible ? d.catchUp401k : 0);
                var lim401k = (d.limit401k + catchUp401) * inflFactor;
                var limIRA = (d.limitIRA + (catchUpEligible ? d.catchUpIRA : 0)) * inflFactor;

                var cD = wantD < lim401k ? wantD : lim401k;
                var cF = wantF < limIRA ? wantF : limIRA;
                var overflow = (wantD - cD) + (wantF - cF);
                var cT = wantT + overflow; // excess spills into brokerage

                // Employer match: matchRate% of your contributions,
                // up to matchCap% of salary — free money into Deferred.
                var matchable = curIncome * matchCap;
                if (cD < matchable) matchable = cD;
                var match = matchable * matchRate;

                curDeferred += cD + match;
                curFree += cF;
                curTaxable += cT;

                if (!lean) contrib = { deferred: cD, free: cF, taxable: cT, match: match, overflow: overflow };
                totalMatch += match;
                totalContributed += cD + cF + cT;

                // Ramp savings rate
                if (curSavingsRate < maxSavingsRate) {
                    curSavingsRate += savingsRateStep;
                    if (curSavingsRate > maxSavingsRate) curSavingsRate = maxSavingsRate;
                }

                curIncome *= (1 + incomeGrowth);
                curExpenses *= (1 + inflation);

            } else {
                /* ---------------- RETIREMENT YEARS ---------------- */
                var netNeed = curExpenses;

                if (netNeed > 0 && curDeferred + curFree + curTaxable <= 0) {
                    if (ranOutOfMoneyAge === null) ranOutOfMoneyAge = age;
                } else if (netNeed > 0) {
                    // Preferred split. Rates are effective taxes, so a net
                    // dollar of spending costs gross = net / (1 - rate).
                    var gotNet = 0;

                    g = netNeed * (isStandardAge ? drawTS : drawTB) / keepT;
                    if (g > curTaxable) g = curTaxable;
                    curTaxable -= g; wdT += g; gotNet += g * keepT;

                    g = netNeed * (isStandardAge ? drawDS : drawDB) / keepD;
                    if (g > curDeferred) g = curDeferred;
                    curDeferred -= g; wdD += g; gotNet += g * keepD;

                    g = netNeed * (isStandardAge ? drawFS : drawFB);
                    if (g > curFree) g = curFree;
                    curFree -= g; wdF += g; gotNet += g;

                    var shortfall = netNeed - gotNet;
                    var initialShortfall = shortfall;

                    // Cover any shortfall by splitting equally across whatever
                    // buckets still have money (original equal-split behavior).
                    var guard = 0;
                    while (shortfall > 1 && guard < 10) {
                        var n = 0;
                        if (curTaxable > 0.01) n++;
                        if (curDeferred > 0.01) n++;
                        if (curFree > 0.01) n++;
                        if (n === 0) break;
                        var chunk = shortfall / n;
                        if (curTaxable > 0.01) {
                            g = chunk / keepT;
                            if (g > curTaxable) g = curTaxable;
                            curTaxable -= g; wdT += g; shortfall -= g * keepT;
                        }
                        if (curDeferred > 0.01) {
                            g = chunk / keepD;
                            if (g > curDeferred) g = curDeferred;
                            curDeferred -= g; wdD += g; shortfall -= g * keepD;
                        }
                        if (curFree > 0.01) {
                            g = chunk;
                            if (g > curFree) g = curFree;
                            curFree -= g; wdF += g; shortfall -= g;
                        }
                        guard++;
                    }

                    if (shortfall > 1 && ranOutOfMoneyAge === null) ranOutOfMoneyAge = age;

                    // Bridge health: before standard age, running the brokerage
                    // dry and having to tap retirement buckets means the bridge
                    // failed (checked against the pre-rescue shortfall, like the
                    // original model).
                    if (!isStandardAge && curTaxable <= 0.01 && initialShortfall > 0.01) {
                        if (bridgeFailureAge === null) bridgeFailureAge = age;
                    }

                    wdGross = wdT + wdD + wdF;
                    wdTaxes = wdT * taxT + wdD * taxD;
                    wdNet = wdGross - wdTaxes;
                    totalTaxes += wdTaxes;
                }

                curExpenses *= (1 + inflation);
            }

            if (curDeferred < 0) curDeferred = 0;
            if (curFree < 0) curFree = 0;
            if (curTaxable < 0) curTaxable = 0;

            var portfolio = curDeferred + curFree + curTaxable;
            var totalNW = portfolio + cash;

            // Someone already past an age gets measured at the first
            // simulated year instead of never.
            if (age === d.retireAge || (age === d.currentAge && d.currentAge > d.retireAge)) {
                netWorthAtRetirement = totalNW;
                expensesAtRetirement = curExpenses / (1 + inflation);
            }

            // Traditional readiness check at the standard access age:
            // can tax-advantaged money alone cover expenses (net of SS) at SWR?
            if (age === d.standardRetireAge || (age === d.currentAge && d.currentAge > d.standardRetireAge)) {
                var safeAmount = (curDeferred + curFree) * swr;
                var expenseNeed = curExpenses / (1 + inflation);
                if (expenseNeed < 1) expenseNeed = 1;
                standardCoverage = (safeAmount / expenseNeed) * 100;
                standardSuccess = safeAmount >= expenseNeed;
            }

            if (totalsOut) totalsOut[yearIndex] = totalNW;

            if (!lean) {
                rows.push({
                    age: age,
                    year: startYear + yearIndex,
                    deferred: curDeferred,
                    free: curFree,
                    taxable: curTaxable,
                    cash: cash,
                    total: totalNW,
                    expenses: curExpenses,
                    isRetired: isRetired,
                    phase: !isRetired ? 'working' : (isStandardAge ? 'standard' : 'bridge'),
                    savingsRate: isRetired ? 0 : curSavingsRate,
                    contrib: contrib,
                    wd: { gross: wdGross, net: wdNet, taxes: wdTaxes, taxable: wdT, deferred: wdD, free: wdF },
                    broke: isRetired && portfolio <= 0
                });
            }

            inflFactor *= (1 + inflation);
        }

        var fiNumber = swr > 0 ? expensesAtRetirement / swr : 0;
        var endingNetWorth = curDeferred + curFree + curTaxable + cash;

        return {
            rows: rows,
            summary: {
                fiNumber: fiNumber,
                netWorthAtRetirement: netWorthAtRetirement,
                expensesAtRetirement: expensesAtRetirement,
                bridgeFailureAge: bridgeFailureAge,
                ranOutOfMoneyAge: ranOutOfMoneyAge,
                standardSuccess: standardSuccess,
                standardCoverage: standardCoverage,
                endingNetWorth: endingNetWorth,
                totalTaxes: totalTaxes,
                totalMatch: totalMatch,
                totalContributed: totalContributed,
                bridgeYears: Math.max(0, d.standardRetireAge - d.retireAge),
                yearsModeled: MAX_AGE - d.currentAge + 1
            }
        };
    }

    /* ---------------------------------------------------------------------
     * monteCarlo(inputs, phases, options)
     *   Runs N lean simulations with normally-distributed annual returns.
     *   options.seed — RNG seed (change it to re-roll).
     * Returns { successRate, sims, bands, endBalance }
     *   bands: per-age percentile envelope of total net worth
     *          { ages, p10, p25, p50, p75, p90 }
     * ------------------------------------------------------------------- */
    function monteCarlo(inputs, phases, options) {
        options = options || {};
        var sims = Math.max(50, Math.min(2000, num(inputs && inputs.mcSims) || DEFAULTS.mcSims));
        var vol = pct(inputs && inputs.volatility !== undefined ? inputs.volatility : DEFAULTS.volatility);
        var mean = pct(inputs && inputs.marketReturn !== undefined ? inputs.marketReturn : DEFAULTS.marketReturn);
        var seed = options.seed !== undefined ? options.seed : 1337;

        var rand = mulberry32(seed);
        var normal = makeNormal(rand);

        var currentAge = num(inputs && inputs.currentAge) || DEFAULTS.currentAge;
        var years = MAX_AGE - currentAge + 1;

        var successes = 0;
        var returnsArr = new Float64Array(years);       // reused every sim
        var matrix = new Float64Array(sims * years);    // total NW, sim-major
        var endBalances = new Float64Array(sims);

        var simOpts = { returns: returnsArr, lean: true, totalsOut: null, startYear: options.startYear };

        for (var i = 0; i < sims; i++) {
            for (var j = 0; j < years; j++) {
                var draw = mean + vol * normal();
                returnsArr[j] = draw > -0.9 ? draw : -0.9;
            }
            simOpts.totalsOut = matrix.subarray(i * years, (i + 1) * years);
            var result = simulate(inputs, phases, simOpts);
            if (result.summary.ranOutOfMoneyAge === null) successes++;
            endBalances[i] = result.summary.endingNetWorth;
        }

        function percentile(sorted, q) {
            var idx = (sorted.length - 1) * q;
            var lo = Math.floor(idx), hi = Math.ceil(idx);
            return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
        }

        // Typed-array sort is numeric by default — no comparator calls.
        var bands = { ages: [], p10: [], p25: [], p50: [], p75: [], p90: [] };
        var scratch = new Float64Array(sims);
        for (var a = 0; a < years; a++) {
            for (var s = 0; s < sims; s++) scratch[s] = matrix[s * years + a];
            scratch.sort();
            bands.ages.push(currentAge + a);
            bands.p10.push(percentile(scratch, 0.10));
            bands.p25.push(percentile(scratch, 0.25));
            bands.p50.push(percentile(scratch, 0.50));
            bands.p75.push(percentile(scratch, 0.75));
            bands.p90.push(percentile(scratch, 0.90));
        }

        endBalances.sort();

        return {
            successRate: successes / sims,
            sims: sims,
            bands: bands,
            endBalance: {
                p10: percentile(endBalances, 0.10),
                p50: percentile(endBalances, 0.50),
                p90: percentile(endBalances, 0.90)
            }
        };
    }

    global.FireEngine = {
        DEFAULTS: DEFAULTS,
        DEFAULT_PHASES: DEFAULT_PHASES,
        MAX_AGE: MAX_AGE,
        simulate: simulate,
        monteCarlo: monteCarlo
    };

})(typeof window !== 'undefined' ? window : globalThis);
