const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the app's calendar and planner without starting its dashboard DOM.
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function loadApp(saved = { webInitialised: true }) {
  const storage = { text: JSON.stringify(saved) };
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, children: [], dataset: {}, attributes: {},
      replaceChildren(...children) { this.children = children; },
      setAttribute(key, value) { this.attributes[key] = value; } });
    return nodes.get(id);
  };
  const context = vm.createContext({
    localStorage: { getItem: () => storage.text, setItem(key, value) { storage.text = value; } },
    document: { getElementById: node, createElement: (tag) => ({
      tagName: tag, dataset: {}, attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; }
    }) }
  });
  vm.runInContext(source.slice(0, source.indexOf('function snapshot()')) +
    source.slice(source.indexOf('function automaticWorkdays('), source.indexOf('function updateGoalOptions(')), context);
  return { context, node, storage };
}

test('office calendar has the expected monthly workday counts', () => {
  const { context } = loadApp();
  for (const [year, month, expected] of [[2026, 9, 22], [2026, 10, 19], [2026, 11, 21], [2027, 0, 20]]) {
    assert.equal(context.automaticWorkdays(new Date(year, month, 1)), expected, `${year}-${month + 1}`);
  }
});

test('only the confirmed office closures and observed weekdays are excluded', () => {
  const { context } = loadApp();
  for (const [month, day] of [[0, 1], [4, 25], [6, 3], [8, 7], [10, 26], [10, 27], [11, 24], [11, 25]]) {
    assert.equal(context.isWorkday(new Date(2026, month, day)), false);
  }
  for (const [month, day] of [[0, 19], [1, 16], [5, 19], [9, 12], [10, 11]]) {
    assert.equal(context.isWorkday(new Date(2026, month, day)), true);
  }
});

test('Thanksgiving Friday moves with Thanksgiving and overlapping Christmas closures count once', () => {
  const { context } = loadApp();
  assert.equal(context.isWorkday(new Date(2027, 10, 25)), false);
  assert.equal(context.isWorkday(new Date(2027, 10, 26)), false);
  assert.equal(context.isWorkday(new Date(2027, 10, 29)), true);
  // Christmas Eve and observed Christmas both fall on Friday, December 24.
  assert.equal(context.isWorkday(new Date(2027, 11, 24)), false);
  assert.equal(context.automaticWorkdays(new Date(2027, 11, 1)), 21);
});

test('observed New Year is excluded when it falls in the preceding December', () => {
  const { context } = loadApp();
  assert.equal(context.isWorkday(new Date(2027, 11, 31)), false);
  assert.equal(context.automaticWorkdays(new Date(2027, 11, 1)), 21);
  assert.equal(context.isWorkday(new Date(2023, 0, 2)), false);
});

test('a future forecast ignores the current custom workday override', () => {
  const { context } = loadApp();
  vm.runInContext('stagedWorkdaysOverride = 17;', context);
  const form = { plannerYear: { value: '2026' }, plannerMonth: { value: '11' } };
  const now = new Date(2026, 10, 2);
  assert.equal(context.plannerPeriod(form, now).workdays, 21);
  assert.equal(context.plannerPeriod(form, now).current, false);
  form.plannerMonth.value = '10';
  assert.equal(context.plannerPeriod(form, now).workdays, 17);
  assert.equal(context.plannerPeriod(form, now).current, true);
  form.plannerYear.value = '';
  assert.equal(context.plannerPeriod(form, now), null);
});

test('future recommendations are previews and do not change the active schedule', () => {
  const { context, node } = loadApp();
  const form = { plannerYear: { value: '2099' }, plannerMonth: { value: '11' },
    payoutTarget: { value: '40000' },
    currency: { value: 'MXN' }, currencyRate: { value: '18' }, giftCard: { value: '0' }, hours: { value: '8' }, comparisonAmount: { value: '' } };
  const before = vm.runInContext('JSON.stringify(data)', context);
  context.updateHoursPlanner(form);
  const recommendations = node('hoursRecommendationOptions').children;
  assert.equal(recommendations.length, 1);
  recommendations.forEach((recommendation) => {
    assert.equal(recommendation.tagName, 'article');
    assert.equal(recommendation.dataset.hours, undefined);
  });
  assert.equal(form.hours.value, '8');
  assert.equal(vm.runInContext('JSON.stringify(data)', context), before);
});

test('single payout targets choose the least collection needed', () => {
  const { context } = loadApp();
  const december = { workdays: 21, remainingDays: 21 };
  const low = context.recommendHours(30000, december, 18, 0);
  const middle = context.recommendHours(40000, december, 18, 0);
  const high = context.recommendHours(50000, december, 18, 0);
  assert.equal(low.hours, 6);
  assert.equal(low.collection, 23058);
  assert.equal(middle.hours, 6);
  assert.equal(middle.collection, 30234.32);
  assert.equal(high.hours, 7);
  assert.equal(high.collection, 34251);
  assert.ok(high.collection * .0835 * 18 >= 50000);
  const november = context.recommendHours(40000, { workdays: 19, remainingDays: 19 }, 18, 0);
  assert.equal(november.hours, 7);
  assert.ok(november.collection < middle.collection);
});

test('remaining pace subtracts collections and uses the days still available', () => {
  const { context } = loadApp();
  const period = { workdays: 21, remainingDays: 5 };
  const plan = context.recommendHours(40000, period, 18, 0, 20000);
  assert.equal(plan.more, 10234.32);
  assert.equal(plan.daily, 2046.87);
  const achieved = context.recommendHours(40000, period, 18, 0, 40000);
  assert.equal(achieved.more, 0);
  assert.equal(achieved.daily, 0);
  const closed = context.recommendHours(40000, { ...period, remainingDays: 0 }, 18, 0);
  assert.equal(closed.daily, null);
});

test('workdays remaining include today but exclude office closures and weekends', () => {
  const { context } = loadApp();
  const month = new Date(2026, 10, 1);
  const counts = context.workdayCounts(month, new Date(2026, 10, 25));
  assert.equal(counts.workdays, 19);
  assert.equal(counts.remainingDays, 2); // Wednesday 25th and Monday 30th.
  assert.equal(context.workdayCounts(month, new Date(2026, 10, 26)).remainingDays, 1);
  assert.equal(context.workdayCounts(new Date(2026, 11, 1), new Date(2026, 10, 25)).remainingDays, 21);
});

test('low targets can use base commission and a bonus can cover the target', () => {
  const { context } = loadApp();
  const base = context.planForPayout(6, 21, 1000, 18, 0);
  assert.equal(base.tier, 'Base');
  assert.ok(base.collection * .0535 * 18 >= 1000);
  const covered = context.recommendHours(30000, { workdays: 21, remainingDays: 21 }, 18, 2000);
  assert.equal(covered.more, 0);
  assert.equal(covered.hours, 6);
});

test('six hours stays capped while seven hours unlocks a higher tier at the correct threshold', () => {
  const { context } = loadApp();
  const six = context.payoutAtCollection(6, 19, 27664, 18);
  const seven = context.payoutAtCollection(7, 19, 27664, 18);
  assert.equal(six.tier, 'Level 3');
  assert.equal(seven.tier, 'Level 4');
  assert.ok(seven.payout > six.payout);
  assert.equal(context.payoutAtCollection(7, 19, 27000, 18).tier, 'Level 3');
  assert.equal(context.payoutAtCollection(6, 19, 100000, 18).tier, 'Level 3');
  assert.equal(context.payoutAtCollection(7, 19, 100000, 18).tier, 'Level 10');
});

test('growth suggestion identifies extra collection and compares payouts at equal collections', () => {
  const { context } = loadApp();
  const growth = context.growthAlternative(19, 26000, 18);
  assert.equal(growth.hours, 7);
  assert.equal(growth.collection, 27664);
  assert.equal(growth.extraCollection, 1664);
  assert.equal(growth.tier, 'Level 4');
  const six = context.payoutAtCollection(6, 19, growth.collection, 18);
  assert.ok(Math.abs(growth.gain - (growth.payout - six.payout)) < 1e-8);
});

test('when collection targets tie, favor the schedule that pays more at that collection', () => {
  const { context } = loadApp();
  const plan = context.recommendHours(40000, { workdays: 19, remainingDays: 5 }, 18, 0, 35000);
  assert.equal(plan.more, 0);
  assert.equal(plan.hours, 7);
});

test('existing range settings migrate to a single target without losing the chosen amount', () => {
  const { context } = loadApp();
  assert.equal(context.normalise({ payoutTargetMin: 45000, payoutTargetMax: 50000 }).payoutTarget, 50000);
  assert.equal(context.normalise({ payoutTarget: 42000, payoutTargetMax: 50000 }).payoutTarget, 42000);
  assert.equal(context.normalise({}).payoutTarget, 40000);
});

test('all dashboard and settings element references still exist after simplification', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const [, id] of source.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(html.includes(`id="${id}"`), `Missing element: ${id}`);
  }
  assert.ok(!html.includes('plannerBand'));
  assert.ok(!html.includes('Payout range'));
});

function savedState(context) { return JSON.parse(vm.runInContext('JSON.stringify(data)', context)); }
const initialCollections = { webInitialised: true, month: '2026-10', day: '2026-10-2', before: 1000, today: 100 };

test('legacy total is preserved separately from the known daily amount', () => {
  const { context } = loadApp(initialCollections);
  assert.equal(context.save(), true);
  const record = savedState(context).collectionHistory['2026-10'];
  assert.equal(record.total, 1100);
  assert.equal(record.adjustment, 1000);
  assert.equal(record.days['2026-10-2'], 100);
});

test('daily saves and corrections replace the daily total instead of counting it twice', () => {
  const { context } = loadApp(initialCollections);
  context.ensureCurrentDate(new Date(2026, 10, 3));
  context.setRecordedDay('2026-10-3', 50);
  context.save(); context.save();
  assert.equal(savedState(context).collectionHistory['2026-10'].total, 1150);
  context.setRecordedDay('2026-10-3', 30);
  context.save();
  assert.equal(savedState(context).collectionHistory['2026-10'].total, 1130);
  context.ensureCurrentDate(new Date(2026, 10, 4));
  assert.equal(savedState(context).before, 1130);
  assert.equal(savedState(context).today, 0);
  assert.equal(savedState(context).collectionHistory['2026-10'].days['2026-10-3'], 30);
});

test('month and year changes archive old totals before resetting the dashboard', () => {
  const { context } = loadApp({ ...initialCollections, month: '2026-11', day: '2026-11-31' });
  context.ensureCurrentDate(new Date(2027, 0, 1));
  const state = savedState(context);
  assert.equal(state.collectionHistory['2026-11'].total, 1100);
  assert.equal(state.collectionHistory['2027-0'].total, 0);
  assert.equal(state.month, '2027-0');
  assert.equal(state.before, 0);
  assert.equal(state.today, 0);
});

test('an entry completed after midnight keeps its original month', () => {
  const { context } = loadApp({ ...initialCollections, day: '2026-10-30' });
  context.ensureCurrentDate(new Date(2026, 11, 1));
  context.setRecordedDay('2026-10-30', 150);
  context.save();
  const state = savedState(context);
  assert.equal(state.collectionHistory['2026-10'].total, 1150);
  assert.equal(state.collectionHistory['2026-10'].days['2026-10-30'], 150);
  assert.equal(state.collectionHistory['2026-11'].total, 0);
  assert.equal(state.today, 0);
});

test('historical corrections and manual balances reconcile without erasing daily entries', () => {
  const { context } = loadApp(initialCollections);
  context.ensureCurrentDate(new Date(2026, 10, 3));
  context.setRecordedDay('2026-10-2', 80);
  context.save();
  assert.equal(savedState(context).before, 1080);
  vm.runInContext('data.before = 50;', context);
  context.save();
  const record = savedState(context).collectionHistory['2026-10'];
  assert.equal(record.days['2026-10-2'], 80);
  assert.equal(record.adjustment, -30);
  assert.equal(record.total, 50);
});

test('history survives reloading and a zero-valued current month', () => {
  const { context, storage } = loadApp(initialCollections);
  context.ensureCurrentDate(new Date(2026, 11, 1));
  const reloaded = loadApp(JSON.parse(storage.text));
  const state = savedState(reloaded.context);
  assert.equal(state.collectionHistory['2026-10'].total, 1100);
  assert.equal(state.before, 0);
  assert.equal(state.today, 0);
  assert.equal(state.day, '2026-11-1');
});

test('bonus is archived with the payout but never counted as collections', () => {
  const { context } = loadApp({ ...initialCollections, giftCard: 40 });
  context.save();
  const record = savedState(context).collectionHistory['2026-10'];
  assert.equal(record.total, 1100);
  assert.equal(record.giftCard, 40);
  assert.equal(record.estimatedPayoutUsd, 1100 * .0535 + 40);
});

test('storage failures are reported and the in-memory ledger remains available for backup', () => {
  const { context, node } = loadApp(initialCollections);
  context.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.equal(context.save(), false);
  assert.equal(savedState(context).collectionHistory['2026-10'].total, 1100);
  assert.match(node('storageStatus').textContent, /Could not save/);
});

test('a stale tab cannot overwrite newer collection history from another tab', () => {
  const { context, storage, node } = loadApp(initialCollections);
  const newer = JSON.stringify({ ...initialCollections, today: 250 });
  storage.text = newer;
  assert.equal(context.save(), false);
  assert.equal(storage.text, newer);
  assert.match(node('storageStatus').textContent, /another tab/);
});

test('comparison colors use identical collections and identify tied best payouts', () => {
  const { context } = loadApp();
  const allEqual = context.compareHoursAtCollection(1000, 19, 18);
  assert.ok(allEqual.every((result) => result.standing === 'equal'));
  const tied = context.compareHoursAtCollection(27000, 19, 18);
  assert.equal(tied[0].payout, tied[1].payout);
  assert.equal(tied[0].standing, 'best');
  assert.equal(tied[1].standing, 'best');
  assert.equal(tied[2].standing, 'lower');
  const higherTier = context.compareHoursAtCollection(30000, 19, 18);
  assert.equal(higherTier[1].standing, 'best');
  assert.equal(higherTier[0].standing, 'lower');
  assert.equal(higherTier[2].standing, 'lower');
  assert.equal(higherTier[1].tier, 'Level 4');
});

test('all lower-paying options are marked lower and a shared bonus does not change ranking', () => {
  const { context } = loadApp();
  const baseline = context.compareHoursAtCollection(35000, 19, 18);
  assert.equal(baseline[0].standing, 'lower');
  assert.equal(baseline[1].standing, 'best');
  assert.equal(baseline[2].standing, 'lower');
  const withBonus = context.compareHoursAtCollection(35000, 19, 18, 40);
  baseline.forEach((result, i) => {
    assert.equal(withBonus[i].standing, result.standing);
    assert.ok(Math.abs(withBonus[i].payout - result.payout - 720) < 1e-8);
  });
});

test('comparison grid includes the exact requested collection without mutating records', () => {
  const { context, node } = loadApp();
  const form = { plannerYear: { value: '2099' }, plannerMonth: { value: '11' },
    comparisonAmount: { value: '27664' }, currency: { value: 'MXN' }, currencyRate: { value: '18' }, giftCard: { value: '0' } };
  const before = savedState(context);
  context.renderHoursComparison(form);
  const html = node('plannerComparison').innerHTML;
  assert.ok(html.includes('$27,664.00'));
  assert.equal((html.match(/class="comparison-selected"/g) || []).length, 1);
  assert.equal((html.match(/<td /g) || []).length, (html.match(/<tr/g) || []).length * 3);
  assert.deepEqual(savedState(context), before);
});

test('comparison reaches every exact 8-hour tier threshold through Level 10', () => {
  const { context } = loadApp();
  for (const workdays of [19, 21, 31]) {
    const amounts = context.comparisonCollections(workdays, 27664);
    const expectedThreshold = 358 * 8 * workdays;
    assert.equal(amounts[amounts.length - 1], expectedThreshold);
    assert.equal(context.payoutAtCollection(8, workdays, expectedThreshold, 18).tier, 'Level 10');
    const reached = new Set(amounts.map((value) => context.payoutAtCollection(8, workdays, value, 18).tier));
    for (let level = 1; level <= 10; level++) assert.ok(reached.has(`Level ${level}`));
    assert.equal(new Set(amounts).size, amounts.length);
  }
});

test('an entered amount above Level 10 is kept without creating an unbounded table', () => {
  const { context } = loadApp();
  const amounts = context.comparisonCollections(19, 1000000);
  assert.ok(amounts.includes(54416));
  assert.equal(amounts[amounts.length - 1], 1000000);
  assert.ok(amounts.length < 40);
});
