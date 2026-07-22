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
    var PLAN_TYPES = { TRADITIONAL: 0, COAST: 1, EARLY: 2 };

    var DEFAULTS = {
        // Profile
        planType: PLAN_TYPES.COAST,
        currentAge: 30,
        coastAge: 40,
        retireAge: 60,
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

        // Shared traditional/Roth account limits, indexed to inflation.
        limit401k: 24500,
        limitIRA: 7500,
        catchUp401k: 8000,
        superCatchUp401k: 11250,  // SECURE 2.0, ages 60-63
        catchUpIRA: 1100,
        catchUpAge: 50,

        // Effective tax rates on withdrawals
        taxDeferredRate: 15,      // % — ordinary income on 401k/IRA draws
        taxTaxableRate: 10,       // % — capital gains on brokerage draws
        // Extra charge on tax-deferred draws before standardRetireAge
        // (the IRS rate is 10%; set 0 for Rule of 55 / 72(t) plans).
        // Roth draws are modeled penalty-free, as contribution withdrawals.
        earlyPenaltyRate: 10,     // %

        // Monte Carlo
        volatility: 15,           // % annual std-dev of returns
        mcSims: 2000
    };

    var INPUT_RULES = {
        planType: { min: PLAN_TYPES.TRADITIONAL, max: PLAN_TYPES.EARLY, integer: true },
        currentAge: { min: 0, max: MAX_AGE, integer: true },
        coastAge: { min: 0, max: MAX_AGE, integer: true },
        retireAge: { min: 0, max: MAX_AGE, integer: true },
        standardRetireAge: { min: 0, max: MAX_AGE, integer: true },
        income: { min: 0, max: 1e15 },
        incomeTaxRate: { min: 0, max: 99 },
        savingsRate: { min: 0, max: 100 },
        savingsRateIncrease: { min: 0, max: 100 },
        maxSavingsRate: { min: 0, max: 100 },
        expenses: { min: 0, max: 1e15 },
        incomeGrowth: { min: -99, max: 100 },
        balDeferred: { min: 0, max: 1e15 },
        balFree: { min: 0, max: 1e15 },
        balTaxable: { min: 0, max: 1e15 },
        balCash: { min: 0, max: 1e15 },
        marketReturn: { min: -99, max: 100 },
        inflation: { min: -99, max: 100 },
        swr: { min: 0.1, max: 100 },
        drawTaxableBridge: { min: 0, max: 100 },
        drawDeferredBridge: { min: 0, max: 100 },
        drawFreeBridge: { min: 0, max: 100 },
        drawTaxableStd: { min: 0, max: 100 },
        drawDeferredStd: { min: 0, max: 100 },
        drawFreeStd: { min: 0, max: 100 },
        employerMatchRate: { min: 0, max: 100 },
        employerMatchCap: { min: 0, max: 100 },
        limit401k: { min: 0, max: 1e9 },
        limitIRA: { min: 0, max: 1e9 },
        catchUp401k: { min: 0, max: 1e9 },
        superCatchUp401k: { min: 0, max: 1e9 },
        catchUpIRA: { min: 0, max: 1e9 },
        catchUpAge: { min: 0, max: MAX_AGE, integer: true },
        taxDeferredRate: { min: 0, max: 99 },
        taxTaxableRate: { min: 0, max: 99 },
        earlyPenaltyRate: { min: 0, max: 99 },
        volatility: { min: 0, max: 100 },
        mcSims: { min: 50, max: 2000, integer: true }
    };

    var DRAW_SETS = [
        ['drawTaxableBridge', 'drawDeferredBridge', 'drawFreeBridge'],
        ['drawTaxableStd', 'drawDeferredStd', 'drawFreeStd']
    ];

    var DEFAULT_PHASES = [
        { id: 1, age: 30, deferred: 50, free: 50, taxable: 0, isLocked: true }
    ];

    var ZERO_CONTRIB = { deferred: 0, free: 0, taxable: 0, match: 0, overflow: 0, workplace: 0, ira: 0 };

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

    function pct(v) { return Number(v) / 100; }

    function normalizeValue(key, value, fallback) {
        var rule = INPUT_RULES[key];
        var n = Number(value);
        if (!Number.isFinite(n)) n = fallback;
        if (rule.integer) n = Math.round(n);
        if (n < rule.min) n = rule.min;
        if (n > rule.max) n = rule.max;
        return n;
    }

    function normalizeDrawSet(d, keys) {
        var total = d[keys[0]] + d[keys[1]] + d[keys[2]];
        if (!(total > 0)) {
            d[keys[0]] = DEFAULTS[keys[0]];
            d[keys[1]] = DEFAULTS[keys[1]];
            d[keys[2]] = DEFAULTS[keys[2]];
            total = 100;
        }
        var scale = 100 / total;
        d[keys[0]] *= scale;
        d[keys[1]] *= scale;
        if (d[keys[0]] + d[keys[1]] > 100) d[keys[1]] = 100 - d[keys[0]];
        d[keys[2]] = 100 - d[keys[0]] - d[keys[1]];
    }

    function normalizeInputs(inputs) {
        var d = {};
        inputs = inputs && typeof inputs === 'object' ? inputs : {};
        for (var k in DEFAULTS) {
            var value = Object.prototype.hasOwnProperty.call(inputs, k) ? inputs[k] : DEFAULTS[k];
            d[k] = normalizeValue(k, value, DEFAULTS[k]);
        }
        if (d.savingsRate > d.maxSavingsRate) d.savingsRate = d.maxSavingsRate;
        if (d.planType === PLAN_TYPES.COAST && d.coastAge > d.retireAge) d.coastAge = d.retireAge;
        DRAW_SETS.forEach(function (keys) { normalizeDrawSet(d, keys); });
        return d;
    }

    function normalizePhases(phases, currentAge) {
        var source = phases && phases.length ? phases : DEFAULT_PHASES;
        var list = [];
        for (var i = 0; i < source.length; i++) {
            var phase = source[i];
            var age = Number(phase && phase.age);
            if (!Number.isFinite(age)) continue;
            age = Math.max(0, Math.min(MAX_AGE, Math.round(age)));
            var deferred = Number(phase.deferred);
            var free = Number(phase.free);
            var taxable = Number(phase.taxable);
            deferred = Number.isFinite(deferred) ? Math.max(0, deferred) : 0;
            free = Number.isFinite(free) ? Math.max(0, free) : 0;
            taxable = Number.isFinite(taxable) ? Math.max(0, taxable) : 0;
            var total = deferred + free + taxable;
            if (!(total > 0)) continue;
            var normalizedDeferred = deferred * 100 / total;
            var normalizedFree = free * 100 / total;
            if (normalizedDeferred + normalizedFree > 100) normalizedFree = 100 - normalizedDeferred;
            list.push({
                id: phase.id,
                age: age,
                deferred: normalizedDeferred,
                free: normalizedFree,
                taxable: 100 - normalizedDeferred - normalizedFree
            });
        }
        list.sort(function (a, b) { return a.age - b.age; });
        if (!list.length || list[0].age > currentAge) {
            list.unshift({ id: 0, age: currentAge, deferred: 50, free: 50, taxable: 0 });
        }
        return list;
    }

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
        var d = normalizeInputs(inputs);
        var phaseList = normalizePhases(phases, d.currentAge);
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
        // Deferred draws before the access age also pay the early penalty
        var taxDB = Math.min(0.99, taxD + pct(d.earlyPenaltyRate));
        var keepDB = 1 - taxDB;
        var keepIncome = 1 - pct(d.incomeTaxRate); // take-home share of gross

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
        var firstInfeasibleAge = null;
        var ranOutOfMoneyAge = null;
        var standardSuccess = false;
        var standardCoverage = 0;
        var effectiveCoastAge = Math.max(d.currentAge, Math.min(d.coastAge, d.retireAge));
        var readinessAge = Math.max(d.retireAge, d.standardRetireAge);
        var coastBalanceAtStart = d.balDeferred * keepD + d.balFree;
        var retirementBalanceAtReadiness = d.balDeferred * keepD + d.balFree + d.balTaxable * keepT;
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
            var isCoasting = d.planType === PLAN_TYPES.COAST && age >= effectiveCoastAge && !isRetired;

            var yearExpenses = curExpenses;
            if (age === d.retireAge || (age === d.currentAge && d.currentAge > d.retireAge)) {
                netWorthAtRetirement = curDeferred + curFree + curTaxable + cash;
                expensesAtRetirement = curExpenses;
            }

            if (age === effectiveCoastAge) {
                coastBalanceAtStart = curDeferred * keepD + curFree;
            }

            if (age === readinessAge || (age === d.currentAge && d.currentAge > readinessAge)) {
                retirementBalanceAtReadiness = curDeferred * keepD + curFree + curTaxable * keepT;
                var safeAmount = (curDeferred * keepD + curFree) * swr;
                if (curExpenses <= 0) {
                    standardCoverage = 100;
                    standardSuccess = true;
                } else {
                    standardCoverage = (safeAmount / curExpenses) * 100;
                    standardSuccess = safeAmount >= curExpenses;
                }
            }

            var r = returns ? Number(returns[yearIndex]) : growth;
            if (!Number.isFinite(r)) r = growth;
            if (r < -1) r = -1;
            curDeferred *= (1 + r);
            curFree *= (1 + r);
            curTaxable *= (1 + r);

            var contrib = ZERO_CONTRIB;
            var usedSavingsRate = 0;
            var wdGross = 0, wdNet = 0, wdTaxes = 0, wdT = 0, wdD = 0, wdF = 0;
            var g;

            if (!isRetired) {
                /* ---------------- WORKING YEARS ---------------- */
                var activePhase = phaseList[0];
                for (var p = phaseCount - 1; p >= 0; p--) {
                    if (phaseList[p].age <= age) { activePhase = phaseList[p]; break; }
                }

                var plannedSavings = isCoasting ? 0 : curIncome * curSavingsRate;
                var availableSavings = Math.max(0, curIncome * keepIncome - curExpenses);
                var totalSavings = Math.min(plannedSavings, availableSavings);
                usedSavingsRate = curIncome > 0 ? totalSavings / curIncome : 0;
                if (firstInfeasibleAge === null && plannedSavings > availableSavings + 1) {
                    firstInfeasibleAge = age;
                }

                var wantD = totalSavings * pct(activePhase.deferred);
                var wantF = totalSavings * pct(activePhase.free);
                var wantT = totalSavings * pct(activePhase.taxable);
                var wantAdvantaged = wantD + wantF;

                // IRS limits, indexed to inflation, with catch-up at 50+.
                // SECURE 2.0: ages 60-63 use the larger 401k super catch-up.
                var catchUpEligible = age >= d.catchUpAge;
                var catchUp401 = age >= 60 && age <= 63 ? d.superCatchUp401k : (catchUpEligible ? d.catchUp401k : 0);
                var lim401k = (d.limit401k + catchUp401) * inflFactor;
                var limIRA = (d.limitIRA + (catchUpEligible ? d.catchUpIRA : 0)) * inflFactor;

                var workplace = Math.min(wantAdvantaged, lim401k);
                var ira = Math.min(wantAdvantaged - workplace, limIRA);
                var acceptedAdvantaged = workplace + ira;
                var deferredShare = wantAdvantaged > 0 ? wantD / wantAdvantaged : 0;
                var cD = acceptedAdvantaged * deferredShare;
                var cF = acceptedAdvantaged - cD;
                var overflow = wantAdvantaged - acceptedAdvantaged;
                var cT = wantT + overflow;

                // Employer match: matchRate% of your contributions,
                // up to matchCap% of salary — free money into Deferred.
                var matchable = Math.min(workplace, curIncome * matchCap);
                var match = matchable * matchRate;

                curDeferred += cD + match;
                curFree += cF;
                curTaxable += cT;

                if (!lean) {
                    contrib = {
                        deferred: cD, free: cF, taxable: cT, match: match,
                        overflow: overflow, workplace: workplace, ira: ira
                    };
                }
                totalMatch += match;
                totalContributed += cD + cF + cT;

                // Ramp savings rate
                if (!isCoasting && curSavingsRate < maxSavingsRate) {
                    curSavingsRate = Math.min(maxSavingsRate, curSavingsRate + savingsRateStep);
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
                    // Deferred draws before the access age pay the early
                    // penalty on top of the effective tax.
                    var keepDNow = isStandardAge ? keepD : keepDB;
                    var gotNet = 0;

                    g = netNeed * (isStandardAge ? drawTS : drawTB) / keepT;
                    if (g > curTaxable) g = curTaxable;
                    curTaxable -= g; wdT += g; gotNet += g * keepT;

                    g = netNeed * (isStandardAge ? drawDS : drawDB) / keepDNow;
                    if (g > curDeferred) g = curDeferred;
                    curDeferred -= g; wdD += g; gotNet += g * keepDNow;

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
                            g = chunk / keepDNow;
                            if (g > curDeferred) g = curDeferred;
                            curDeferred -= g; wdD += g; shortfall -= g * keepDNow;
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
                    wdTaxes = wdT * taxT + wdD * (1 - keepDNow);
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
                    expenses: yearExpenses,
                    isRetired: isRetired,
                    phase: isCoasting ? 'coasting' : (!isRetired ? 'working' : (isStandardAge ? 'standard' : 'bridge')),
                    savingsRate: isRetired ? 0 : usedSavingsRate,
                    contrib: contrib,
                    wd: { gross: wdGross, net: wdNet, taxes: wdTaxes, taxable: wdT, deferred: wdD, free: wdF },
                    broke: isRetired && portfolio <= 0
                });
            }

            inflFactor *= (1 + inflation);
        }

        var fiNumber = swr > 0 ? expensesAtRetirement / swr : 0;
        var coastYears = Math.max(0, readinessAge - d.currentAge);
        var unlockExpenses = d.expenses * Math.pow(1 + inflation, coastYears);
        var fiNumberAtUnlock = swr > 0 ? unlockExpenses / swr : 0;
        var coastGrowth = 1 + growth;
        var coastNumber = coastGrowth > 0 ? fiNumberAtUnlock / Math.pow(coastGrowth, coastYears) : 0;
        var coastBalanceToday = d.balDeferred * keepD + d.balFree;
        var coastRunwayYears = Math.max(0, readinessAge - effectiveCoastAge);
        var coastTargetAtStart = coastGrowth > 0
            ? fiNumberAtUnlock / Math.pow(coastGrowth, coastRunwayYears)
            : 0;
        var coastCoverageAtStart = coastTargetAtStart > 0
            ? coastBalanceAtStart / coastTargetAtStart * 100
            : 100;
        var retirementCoverageAtReadiness = fiNumberAtUnlock > 0
            ? retirementBalanceAtReadiness / fiNumberAtUnlock * 100
            : 100;
        var endingNetWorth = curDeferred + curFree + curTaxable + cash;

        return {
            rows: rows,
            summary: {
                fiNumber: fiNumber,
                fiNumberAtUnlock: fiNumberAtUnlock,
                coastNumber: coastNumber,
                coastBalanceToday: coastBalanceToday,
                coastYears: coastYears,
                coastStartAge: effectiveCoastAge,
                coastBalanceAtStart: coastBalanceAtStart,
                coastTargetAtStart: coastTargetAtStart,
                coastCoverageAtStart: coastCoverageAtStart,
                readinessAge: readinessAge,
                retirementBalanceAtReadiness: retirementBalanceAtReadiness,
                retirementCoverageAtReadiness: retirementCoverageAtReadiness,
                netWorthAtRetirement: netWorthAtRetirement,
                expensesAtRetirement: expensesAtRetirement,
                bridgeFailureAge: bridgeFailureAge,
                firstInfeasibleAge: firstInfeasibleAge,
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
     *   Runs N lean simulations with lognormally-distributed gross returns.
     *   options.seed — RNG seed (change it to re-roll).
     * Returns { successRate, sims, bands, endBalance }
     *   bands: per-age percentile envelope of total net worth
     *          { ages, p10, p25, p50, p75, p90 }
     * ------------------------------------------------------------------- */
    function monteCarlo(inputs, phases, options) {
        options = options || {};
        var d = normalizeInputs(inputs);
        var sims = d.mcSims;
        var vol = pct(d.volatility);
        var mean = pct(d.marketReturn);
        var seed = options.seed !== undefined ? options.seed : 1337;

        var rand = mulberry32(seed);
        var normal = makeNormal(rand);

        var currentAge = d.currentAge;
        var years = MAX_AGE - currentAge + 1;

        var successes = 0;
        var returnsArr = new Float64Array(years);       // reused every sim
        var matrix = new Float64Array(sims * years);    // total NW, sim-major
        var endBalances = new Float64Array(sims);

        var simOpts = { returns: returnsArr, lean: true, totalsOut: null, startYear: options.startYear };

        var grossMean = 1 + mean;
        var lnVariance = Math.log(1 + Math.pow(vol / grossMean, 2));
        var lnVol = Math.sqrt(lnVariance);
        var lnMean = Math.log(grossMean) - lnVariance / 2;

        for (var i = 0; i < sims; i++) {
            for (var j = 0; j < years; j++) {
                returnsArr[j] = Math.exp(lnMean + lnVol * normal()) - 1;
            }
            simOpts.totalsOut = matrix.subarray(i * years, (i + 1) * years);
            var result = simulate(d, phases, simOpts);
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
            returnModel: {
                arithmeticMean: mean,
                standardDeviation: vol,
                logMean: lnMean,
                logStandardDeviation: lnVol
            },
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
        PLAN_TYPES: PLAN_TYPES,
        DEFAULT_PHASES: DEFAULT_PHASES,
        INPUT_RULES: INPUT_RULES,
        DRAW_SETS: DRAW_SETS,
        MAX_AGE: MAX_AGE,
        normalizeInputs: normalizeInputs,
        simulate: simulate,
        monteCarlo: monteCarlo
    };

})(typeof window !== 'undefined' ? window : globalThis);
