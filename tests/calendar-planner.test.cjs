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
    payoutTargetMin: { value: '30000' }, payoutTargetMax: { value: '40000' },
    currency: { value: 'MXN' }, currencyRate: { value: '18' }, giftCard: { value: '0' }, hours: { value: '8' } };
  const before = vm.runInContext('JSON.stringify(data)', context);
  context.updateHoursPlanner(form);
  const recommendations = node('hoursRecommendationOptions').children;
  assert.equal(recommendations.length, 2);
  recommendations.forEach((recommendation) => {
    assert.equal(recommendation.tagName, 'article');
    assert.equal(recommendation.dataset.hours, undefined);
  });
  assert.equal(form.hours.value, '8');
  assert.equal(vm.runInContext('JSON.stringify(data)', context), before);
});
