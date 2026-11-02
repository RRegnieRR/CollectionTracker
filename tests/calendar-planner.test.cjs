const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the app's calendar and planner without starting its dashboard DOM.
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function loadApp() {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, children: [], dataset: {}, attributes: {},
      replaceChildren(...children) { this.children = children; },
      setAttribute(key, value) { this.attributes[key] = value; } });
    return nodes.get(id);
  };
  const context = vm.createContext({
    localStorage: { getItem: () => JSON.stringify({ webInitialised: true }), setItem() {} },
    document: { getElementById: node, createElement: (tag) => ({
      tagName: tag, dataset: {}, attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; }
    }) }
  });
  vm.runInContext(source.slice(0, source.indexOf('function snapshot()')) +
    source.slice(source.indexOf('function automaticWorkdays('), source.indexOf('function updateGoalOptions(')), context);
  return { context, node };
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
    currency: { value: 'MXN' }, currencyRate: { value: '18' }, giftCard: { value: '0' }, hours: { value: '8' } };
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
