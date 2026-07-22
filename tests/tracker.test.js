require('C:/source/FIRE-CALCULATOR/js/tracker/engine.js');
require('C:/source/FIRE-CALCULATOR/js/tracker/rocketmoney.js');
require('C:/source/FIRE-CALCULATOR/js/tracker/store.js');
const T = globalThis.TrackerEngine;
const RM = globalThis.RocketMoney;
const S = globalThis.TrackerStore;

let failures = 0;
function check(name, cond, detail) {
    if (!cond) { failures++; console.log('FAIL: ' + name + (detail ? ' — ' + detail : '')); }
    else console.log('ok:   ' + name);
}

// ---------- month helpers ----------
check('monthKey from ISO', T.monthKey('2025-01-13') === '2025-01');
check('monthKey year rollover', T.nextMonth('2024-12') === '2025-01');
check('monthLabel', T.monthLabel('2024-03') === 'Mar 2024');

// ---------- category kinds ----------
check('Mortgage is fixed', T.categoryKind('Mortgage') === 'fixed');
check('Groceries is variable', T.categoryKind('Groceries') === 'variable');
check('Dining is spending', T.categoryKind('Dining & Drinks') === 'spending');
check('Paychecks is income', T.categoryKind('Paychecks') === 'income');
check('Credit Card Payment is transfer', T.categoryKind('Credit Card Payment') === 'transfer');
check('unknown category is spending', T.categoryKind('Snowboarding') === 'spending');

// ---------- net worth series ----------
const state = {
    accounts: [
        { id: 'a', name: 'Savings', group: 'cash' },
        { id: 'b', name: 'Roth', group: 'taxFree' },
        { id: 'c', name: '401k', group: 'taxDeferred' },
        { id: 'd', name: 'Brokerage', group: 'afterTax' },
        { id: 'e', name: 'House', group: 'property' },
        { id: 'f', name: 'Mortgage', group: 'liability' }
    ],
    snapshots: {
        '2025-01': { a: 1000, b: 5000, c: 4000, d: 2000, e: 500000, f: 400000 },
        '2025-02': { a: 1100, b: 5200, c: 4100, d: 2100, e: 500000, f: 399000 }
    },
    txns: []
};
const s = T.series(state);
check('series months sorted', s.months.join(',') === '2025-01,2025-02');
check('assets sum', s.assets[0] === 512000, '=' + s.assets[0]);
check('net worth = assets - liabilities', s.netWorth[0] === 112000, '=' + s.netWorth[0]);
check('investable excludes property', s.investable[0] === 12000, '=' + s.investable[0]);

const b = T.buckets(state);
check('buckets use latest month', b.month === '2025-02');
check('bucket deferred', b.deferred === 4100);
check('bucket free', b.free === 5200);
check('bucket taxable = afterTax only', b.taxable === 2100, '=' + b.taxable);
check('bucket cash stays separate', b.cash === 1100, '=' + b.cash);

// ---------- expenses ----------
const txns = [
    { date: '2025-01-01', name: 'Paycheck', amount: 5000, category: 'Paychecks' },
    { date: '2025-01-02', name: 'Mr. Cooper', amount: 2700, category: 'Mortgage' },
    { date: '2025-01-05', name: 'Fred Meyer', amount: 100, category: 'Groceries' },
    { date: '2025-01-07', name: 'Fred Meyer', amount: -20, category: 'Groceries' }, // refund
    { date: '2025-01-09', name: 'Dutch Bros', amount: 10, category: 'Coffee' },
    { date: '2025-01-10', name: 'CC Payment', amount: 900, category: 'Credit Card Payment' }, // ignored
    { date: '2025-02-01', name: 'Paycheck', amount: 5000, category: 'Paychecks' },
    { date: '2025-02-03', name: 'Cafe Yumm', amount: 40, category: 'Dining & Drinks' }
];
const byMo = T.spendByMonth(txns);
check('two txn months', Object.keys(byMo).length === 2);
check('income summed', byMo['2025-01'].income === 5000);
check('fixed = mortgage', byMo['2025-01'].fixed === 2700);
check('refund nets against category', byMo['2025-01'].byCategory['Groceries'] === 80);
check('transfers excluded', byMo['2025-01'].expenses === 2790, '=' + byMo['2025-01'].expenses);
check('saved = income - expenses', byMo['2025-01'].saved === 2210);

const janRows = T.categoryRows(byMo['2025-01']);
check('income listed by category', janRows.income.length === 1 &&
    janRows.income[0].category === 'Paychecks' && janRows.income[0].amount === 5000);

const trail = T.trailing(txns, 12);
check('trailing annualizes short history', Math.abs(trail.annualIncome - 60000) < 1, '=' + trail.annualIncome);
check('trailing savings rate', Math.abs(trail.savingsRate - (10000 - 2830) / 10000) < 1e-9, '=' + trail.savingsRate);

const top = T.topMerchants(txns, '2025-01', 3);
check('top merchant is mortgage', top[0].name === 'Mr. Cooper');

// A month holding only transfers never materializes as an aggregate, so it
// cannot dilute trailing() or read as a "+$0" month
const transferOnly = txns.concat([{ date: '2025-03-10', name: 'CC Payment', amount: 900, category: 'Credit Card Payment' }]);
check('transfer-only month has no aggregate', T.spendByMonth(transferOnly)['2025-03'] === undefined);
check('transfer-only month absent from trailing', T.trailing(transferOnly, 12).months === 2);

// ---------- PAW / AAW / UAW benchmarks (The Millionaire Next Door: age × income / 10) ----------
const b25 = T.benchmarks(25, 170000);
check('AAW at 25/170k', Math.abs(b25.aaw - 425000) < 0.01, '=' + b25.aaw);
check('PAW = 2×AAW', Math.abs(b25.paw - 850000) < 0.01);
check('UAW = AAW/2', Math.abs(b25.uaw - 212500) < 0.01);
const b26 = T.benchmarks(26, 173000);
check('AAW at 26/173k', Math.abs(b26.aaw - 449800) < 0.01, '=' + b26.aaw);
const b27 = T.benchmarks(27, 180000);
check('PAW at 27/180k', Math.abs(b27.paw - 972000) < 0.01, '=' + b27.paw);
check('AAW stays sane at 50+', Math.abs(T.benchmarks(50, 100000).aaw - 500000) < 0.01 &&
    Math.abs(T.benchmarks(60, 100000).aaw - 600000) < 0.01);
check('benchmarks null without inputs', T.benchmarks(0, 100000) === null && T.benchmarks(30, 0) === null);

const benchState = {
    ageIncome: { '2024-03': { age: 25, income: 170000 } },
    profile: { birthMonth: null, annualIncome: null }
};
check('exact ageIncome entry wins', T.ageIncomeAt(benchState, '2024-03').age === 25);
check('carry-forward advances age by elapsed years', T.ageIncomeAt(benchState, '2025-04').age === 26);
check('carry-forward keeps income', T.ageIncomeAt(benchState, '2025-04').income === 170000);
const profState = { ageIncome: {}, profile: { birthMonth: '1998-04', annualIncome: 180000 } };
check('profile fallback derives age', T.ageIncomeAt(profState, '2026-06').age === 28);
check('no data → null', T.ageIncomeAt({ ageIncome: {}, profile: {} }, '2026-06') === null);
const bs = T.benchmarkSeries(benchState, ['2024-03', '2024-04']);
check('benchmarkSeries aligned + flagged', bs.any === true && bs.paw.length === 2 && Math.abs(bs.paw[0] - 850000) < 0.01);

// income-only entries (the grid's income row) resolve age from the profile
const mixState = {
    ageIncome: { '2026-01': { income: 190000 } },
    profile: { birthMonth: '1998-04', annualIncome: 180000 }
};
check('income-only entry keeps profile age', T.ageIncomeAt(mixState, '2026-01').age === 27);
check('income-only entry overrides profile income', T.ageIncomeAt(mixState, '2026-01').income === 190000);
check('later months inherit recorded income', T.ageIncomeAt(mixState, '2026-06').income === 190000);
check('earlier months keep profile income', T.ageIncomeAt(mixState, '2025-06').income === 180000);

// ---------- store: cashbook month deletion ----------
S.init();
S.addTxn({ date: '2025-01-05', name: 'A', amount: 10, category: 'Groceries' });
S.addTxn({ date: '2025-01-20', name: 'B', amount: 5, category: 'Coffee' });
S.addTxn({ date: '2025-02-05', name: 'C', amount: 20, category: 'Groceries' });
S.addCashMonth(); // opens 2025-03
check('addCashMonth opens next month', S.get().cashMonths.indexOf('2025-03') !== -1);
S.removeCashMonth('2025-01');
check('removeCashMonth drops that month\'s txns',
    S.get().txns.length === 1 && S.get().txns[0].date === '2025-02-05');
S.removeCashMonth('2025-03');
check('removeCashMonth drops open month marker', S.get().cashMonths.length === 0);
check('other months untouched', S.get().txns.length === 1);

// ---------- adopt sanitization ----------
S.replace({
    accounts: [{ id: 'ok', name: 'Savings', group: 'cash' }, { id: 'bad', name: 'Mystery', group: 'nope' }],
    snapshots: { '2026-01': { ok: 100, bad: 999 } },
    txns: []
});
check('adopt drops unknown account groups', S.get().accounts.length === 1 && S.get().accounts[0].id === 'ok');
check('series ignores the orphan balance', T.series(S.get()).netWorth[0] === 100);
S.replace(null); // back to a blank slate (reset() needs the browser's localStorage)

// ---------- Rocket Money CSV ----------
const csv =
'Date,Original Date,Account Type,Account Name,Account Number,Institution Name,Name,Custom Name,Amount,Description,Category,Note,Ignored From,Tax Deductible\n' +
'2025-01-03,2025-01-03,Credit Card,Alaska Visa,7860,Bank of America,"ALMA, Therapy",,25.00,SQ *ALMA,Therapy,,,\n' +
'2025-01-03,2025-01-03,Cash,WAY2SAVE,0508,Wells Fargo,Mr. Cooper,,2668.71,NSM DBAMR.COOPER,Mortgage,,,\n' +
'2025-01-04,2025-01-04,Credit Card,VentureOne,3737,Capital One,"Quote ""Test""",,17.40,TWO DOGS,Dining & Drinks,,,\n' +
'2025-01-06,2025-01-06,Cash,Checking,8821,U.S. Bank,Paycheck,,-4600.00,DIRECT DEP,Paychecks,,,\n' +
'2025-01-07,2025-01-07,Credit Card,VentureOne,3737,Capital One,Hidden Thing,,50.00,HIDDEN,Shopping,,everything,\n';

const parsed = RM.parse(csv);
check('parse count (ignored row skipped)', parsed.txns.length === 4, '=' + parsed.txns.length);
check('ignored-from row skipped', parsed.skipped === 1);
check('no flip when expenses positive', parsed.flipped === false);
check('quoted comma preserved', parsed.txns[0].name === 'ALMA, Therapy');
check('escaped quotes preserved', parsed.txns[2].name === 'Quote "Test"');
check('income normalized positive', parsed.txns[3].amount === 4600);
check('stable ids', parsed.txns[0].id === RM.parse(csv).txns[0].id);

// debit-negative convention flips
const csvNeg =
'Date,Name,Amount,Category\n' +
'2025-01-03,Fred Meyer,-52.73,Groceries\n' +
'2025-01-04,Dutch Bros,-8.50,Coffee\n' +
'2025-01-05,Paycheck,4600.00,Paychecks\n';
const parsedNeg = RM.parse(csvNeg);
check('debit-negative export flipped', parsedNeg.flipped === true);
check('expense positive after flip', parsedNeg.txns[0].amount === 52.73);
check('income stays positive after flip', parsedNeg.txns[2].amount === 4600);

// M/D/YYYY dates
const csvUS = 'Date,Name,Amount,Category\n1/9/2025,Test,10.00,Fees\n';
check('US date parsed', RM.parse(csvUS).txns[0].date === '2025-01-09');

// garbage in
check('non-CSV rejected', !!RM.parse('hello world').error);

// ---------- savings contributions (marked, not assumed) ----------
check('Savings is a saving kind', T.categoryKind('Savings') === 'saving');
check('Retirement Contributions is saving', T.categoryKind('Retirement Contributions') === 'saving');
check('Credit Card Payment still transfer', T.categoryKind('Credit Card Payment') === 'transfer');
const savTxns = [
    { date: '2025-05-01', name: 'Paycheck', amount: 5000, category: 'Paychecks' },
    { date: '2025-05-02', name: 'Vanguard', amount: 1200, category: 'Investments' },
    { date: '2025-05-03', name: 'Ally', amount: 300, category: 'Savings' },
    { date: '2025-05-04', name: 'Fred Meyer', amount: 500, category: 'Groceries' },
    { date: '2025-05-05', name: 'CC Payment', amount: 900, category: 'Credit Card Payment' }
];
const savMo = T.spendByMonth(savTxns)['2025-05'];
check('saving aggregated separately', savMo.saving === 1500);
check('saving not counted as expense', savMo.expenses === 500);
check('surplus unchanged by saving', savMo.saved === 4500);
const savTrail = T.trailing(savTxns, 12);
check('trailing reports marked saving', savTrail.annualSaving === 18000 && savTrail.savedIsMarked === true);
check('marked rate = saving/income', Math.abs(savTrail.savingsRate - 1500 / 5000) < 1e-9, '=' + savTrail.savingsRate);
const noMark = T.trailing([
    { date: '2025-05-01', name: 'Paycheck', amount: 5000, category: 'Paychecks' },
    { date: '2025-05-04', name: 'Fred Meyer', amount: 500, category: 'Groceries' }
], 12);
check('unmarked falls back to surplus rate', noMark.savedIsMarked === false && Math.abs(noMark.savingsRate - 0.9) < 1e-9);
const savRows = T.categoryRows(savMo);
check('saving section rows', savRows.saving.length === 2 && savRows.saving[0].category === 'Investments');
check('savings excluded from top merchants', T.topMerchants(savTxns, '2025-05', 5)[0].name === 'Fred Meyer');

// ---------- category kind overrides ----------
T.setKindOverrides({ 'Side Hustle': 'income', 'Groceries': 'fixed', 'Bogus': 'notakind' });
check('override makes unknown category income', T.categoryKind('side hustle') === 'income');
check('override rewires a built-in category', T.categoryKind('Groceries') === 'fixed');
check('invalid kind ignored', T.categoryKind('Bogus') === 'spending');
check('defaultKind ignores overrides', T.defaultKind('Groceries') === 'variable');
const ovMo = T.spendByMonth([
    { date: '2025-03-01', name: 'Etsy', amount: 200, category: 'Side Hustle' },
    { date: '2025-03-02', name: 'Fred Meyer', amount: 50, category: 'Groceries' }
])['2025-03'];
check('aggregates respect overrides', ovMo.income === 200 && ovMo.fixed === 50 && ovMo.variable === 0);
T.setKindOverrides({});
check('overrides clear', T.categoryKind('Groceries') === 'variable');

// store setters install overrides and validate input
S.setCategoryKind('Consulting', 'income');
check('store override applied to engine', T.categoryKind('Consulting') === 'income');
S.setCategoryKind('Consulting', 'spending'); // the default for unknowns → cleared
check('setting the default clears the override', S.get().categoryKinds['Consulting'] === undefined);
check('cleared override falls back', T.categoryKind('Consulting') === 'spending');
S.setCsvColumn('amount', 'Value');
check('csv column stored', S.get().csvColumns.amount === 'Value');
S.setCsvColumn('amount', ' ');
check('blank csv column cleared', S.get().csvColumns.amount === undefined);

// ---------- custom CSV columns ----------
const csvCustom =
'Posted On,Payee,Value,Bucket\n' +
'2025-01-03,Fred Meyer,52.73,Groceries\n' +
'2025-01-06,Paycheck,4600.00,Paychecks\n';
const noMap = RM.parse(csvCustom);
check('unmapped custom headers rejected', !!noMap.error);
const mapped = RM.parse(csvCustom, { columns: { date: 'Posted On', name: 'Payee', amount: 'Value', category: 'Bucket' } });
check('custom columns parse', !mapped.error && mapped.txns.length === 2, mapped.error || '=' + mapped.txns.length);
check('custom columns land in fields', mapped.txns[0].name === 'Fred Meyer' && mapped.txns[0].category === 'Groceries' && mapped.txns[0].amount === 52.73);
check('custom mapping wins over builtin', RM.parse('Date,Name,Amount,Category,Other\n2025-01-03,A,5.00,X,9.99\n',
    { columns: { amount: 'Other' } }).txns[0].amount === 9.99);

// the downloadable template round-trips through the parser
const tmpl = RM.parse(RM.template());
check('template parses without error', !tmpl.error);
check('template rows all imported', tmpl.txns.length === 6 && tmpl.skipped === 0, '=' + tmpl.txns.length + '/' + tmpl.skipped);
check('template keeps expense-positive convention', tmpl.flipped === false);
check('template income positive', tmpl.txns[0].amount === 4600 && T.categoryKind(tmpl.txns[0].category) === 'income');
check('template quoted merchant preserved', tmpl.txns.some(t => t.name === 'Corner Cafe, The'));

console.log(failures ? '\n' + failures + ' failure(s)' : '\nAll tracker tests passed');
process.exit(failures ? 1 : 0);
