const KEY = 'collection-tracker-web-v1';
const defaults = { goal: 0, goalMode: 'custom', goalTier: null, before: 0, today: 0, hours: 6, rate: 18, currency: 'USD', customCurrency: 'EUR', currencyRate: 1, giftCard: 0, payoutTargetMin: 30000, payoutTargetMax: 40000, workdaysOverride: null, workdaysOverrideMonth: '', month: '', day: '', webInitialised: false };
const tiers = [
  ['Level 1', 133, .0635], ['Level 2', 158, .0685], ['Level 3', 183, .0735], ['Level 4', 208, .0785], ['Level 5', 233, .0835],
  ['Level 6', 258, .0885], ['Level 7', 283, .0935], ['Level 8', 308, .0985], ['Level 9', 333, .1035], ['Level 10', 358, .1085]
];
const originalWindowsValues = {
  goal: 29358,
  before: 8531,
  today: 811,
  hours: 6,
  rate: 16.9243,
  month: '2026-8',
  day: '2026-8-9',
  importedOriginalApp: true
};
const $ = (id) => document.getElementById(id);

function amount(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function readData() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const hasWebValues = amount(saved.goal) > 0 || amount(saved.before) > 0 || amount(saved.today) > 0;
    return hasWebValues || saved.importedOriginalApp || saved.webInitialised ? saved : originalWindowsValues;
  } catch {
    return originalWindowsValues;
  }
}

function normalise(values) {
  const currency = ['USD', 'MXN', 'CUSTOM'].includes(String(values.currency || 'USD').toUpperCase()) ? String(values.currency || 'USD').toUpperCase() : 'USD';
  const savedGoalTier = Number(values.goalTier);
  const payoutTargetMin = Math.max(0, amount(values.payoutTargetMin, defaults.payoutTargetMin));
  const payoutTargetMax = Math.max(payoutTargetMin, amount(values.payoutTargetMax, defaults.payoutTargetMax));
  const hasValidGoalTier = values.goalMode === 'tier' && values.goalTier !== null && values.goalTier !== '' && Number.isInteger(savedGoalTier) && savedGoalTier >= 0 && savedGoalTier < tiers.length;
  return {
    ...defaults,
    ...values,
    goal: amount(values.goal),
    goalMode: hasValidGoalTier ? 'tier' : 'custom',
    goalTier: hasValidGoalTier ? savedGoalTier : null,
    before: amount(values.before),
    today: amount(values.today),
    hours: Math.min(8, Math.max(0.1, amount(values.hours, defaults.hours))),
    rate: Math.max(0.01, amount(values.rate, defaults.rate)),
    currency,
    customCurrency: /^[A-Za-z]{3}$/.test(String(values.customCurrency || '')) ? String(values.customCurrency).toUpperCase() : defaults.customCurrency,
    currencyRate: Math.max(0.0001, amount(values.currencyRate, currency === 'MXN' ? amount(values.rate, defaults.rate) : 1)),
    giftCard: amount(values.giftCard),
    payoutTargetMin,
    payoutTargetMax,
    workdaysOverride: values.workdaysOverride == null ? null : Math.max(1, Math.min(31, Math.round(amount(values.workdaysOverride)))),
    workdaysOverrideMonth: /^\d{4}-\d{1,2}$/.test(String(values.workdaysOverrideMonth || '')) ? String(values.workdaysOverrideMonth) : ''
  };
}

let data = normalise({ ...defaults, ...readData() });
let stagedToday = null;
let stagedWorkdaysOverride = null;
let visibleTierCount = 5;
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount(value));
function payoutCurrency() { return data.currency === 'CUSTOM' ? data.customCurrency : data.currency; }
function payoutRate() { return payoutCurrency() === 'USD' ? 1 : data.currencyRate; }
function payoutMoney(value) {
  const code = payoutCurrency();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount(value) * payoutRate());
  } catch {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount(value));
  }
}
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const dateKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const monthKey = (date) => `${date.getFullYear()}-${date.getMonth()}`;

function save() {
  localStorage.setItem(KEY, JSON.stringify(data));
}

if (data.importedOriginalApp) save();

function ensureCurrentDate() {
  const now = new Date();
  const currentMonth = monthKey(now);
  const currentDay = dateKey(now);
  if (!data.month) {
    data.month = currentMonth;
    data.day = currentDay;
    save();
    return;
  }
  if (data.month !== currentMonth) {
    data.before = 0;
    data.today = 0;
    data.workdaysOverride = null;
    data.workdaysOverrideMonth = '';
    data.month = currentMonth;
    data.day = currentDay;
    save();
  } else if (data.day !== currentDay) {
    data.before += data.today;
    data.today = 0;
    data.day = currentDay;
    save();
  }
  if (data.workdaysOverride !== null && data.workdaysOverrideMonth !== currentMonth) {
    data.workdaysOverride = null;
    data.workdaysOverrideMonth = '';
    save();
  }
}

function observedFixed(year, month, day) {
  const date = new Date(year, month, day);
  if (date.getDay() === 6) return new Date(year, month, day - 1);
  if (date.getDay() === 0) return new Date(year, month, day + 1);
  return date;
}
function nth(year, month, weekday, occurrence) {
  const first = new Date(year, month, 1);
  return new Date(year, month, 1 + ((weekday - first.getDay() + 7) % 7) + (occurrence - 1) * 7);
}
function last(year, month, weekday) {
  const date = new Date(year, month + 1, 0);
  return new Date(year, month, date.getDate() - ((date.getDay() - weekday + 7) % 7));
}
function holidays(year) {
  // Office closures; next New Year's can be observed in December.
  const thanksgiving = nth(year, 10, 4, 4);
  return [
    observedFixed(year, 0, 1), last(year, 4, 1), observedFixed(year, 6, 4),
    nth(year, 8, 1, 1), thanksgiving, new Date(year, 10, thanksgiving.getDate() + 1),
    new Date(year, 11, 24), observedFixed(year, 11, 25),
    observedFixed(year + 1, 0, 1)
  ].map(dateKey);
}
function isWorkday(date) {
  return date.getDay() !== 0 && date.getDay() !== 6 && !holidays(date.getFullYear()).includes(dateKey(date));
}

const maxTierForSixOrFewerHours = 3;

function tierGoal(index, hours, workdays) {
  const tier = tiers[index];
  return tier ? tier[1] * Math.max(0.1, amount(hours, defaults.hours)) * Math.max(1, amount(workdays, 1)) : 0;
}

function planForPayout(hours, workdays, payoutTargetMxn, mxnRate, giftCard) {
  const targetUsd = Math.max(0, payoutTargetMxn / mxnRate);
  if (giftCard >= targetUsd) return { hours, collection: 0, dailyCollection: 0, tier: 'Bonus only' };
  const availableTiers = [['Base', 0, .0535], ...(hours <= 6 ? tiers.slice(0, maxTierForSixOrFewerHours) : tiers)];
  for (let index = 0; index < availableTiers.length; index += 1) {
    const tier = availableTiers[index];
    const minimum = tier[1] * hours * workdays;
    const nextMinimum = index + 1 < availableTiers.length ? availableTiers[index + 1][1] * hours * workdays : Infinity;
    const collection = Math.ceil((Math.max(minimum, (targetUsd - giftCard) / tier[2]) - 1e-9) * 100) / 100;
    if (collection < nextMinimum || index === availableTiers.length - 1) {
      return { hours, collection, dailyCollection: collection / workdays, tier: tier[0] };
    }
  }
  return null;
}

function payoutAtCollection(hours, workdays, collection, mxnRate, giftCard = 0) {
  let tier = ['Base', 0, .0535];
  const available = hours <= 6 ? tiers.slice(0, maxTierForSixOrFewerHours) : tiers;
  for (const candidate of available) {
    if (collection + 1e-9 >= candidate[1] * hours * workdays) tier = candidate;
    else break;
  }
  return { tier: tier[0], rate: tier[2], payout: (collection * tier[2] + giftCard) * mxnRate };
}

function growthAlternative(workdays, reference, mxnRate, giftCard = 0) {
  const options = [];
  for (const hours of [7, 8]) {
    for (const tier of tiers.slice(maxTierForSixOrFewerHours)) {
      const collection = Math.max(reference, tier[1] * hours * workdays);
      const upgraded = payoutAtCollection(hours, workdays, collection, mxnRate, giftCard);
      const capped = payoutAtCollection(6, workdays, collection, mxnRate, giftCard);
      if (upgraded.payout <= capped.payout) continue;
      options.push({ hours, collection, extraCollection: Math.max(0, collection - reference), gain: upgraded.payout - capped.payout, payout: upgraded.payout, tier: upgraded.tier });
      break;
    }
  }
  return options.sort((a, b) => a.extraCollection - b.extraCollection || a.hours - b.hours)[0] ?? null;
}

function workdayCounts(date, now = new Date(), override = null) {
  let total = 0, remaining = 0;
  const current = monthKey(date) === monthKey(now);
  const future = new Date(date.getFullYear(), date.getMonth(), 1) > new Date(now.getFullYear(), now.getMonth(), 1);
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= days; day += 1) {
    if (!isWorkday(new Date(date.getFullYear(), date.getMonth(), day))) continue;
    total += 1;
    if (future || (current && day >= now.getDate())) remaining += 1;
  }
  const elapsedBeforeToday = total - remaining;
  return { workdays: override ?? total, remainingDays: override === null ? remaining : Math.max(0, override - elapsedBeforeToday) };
}

function recommendPayoutRange(minTarget, maxTarget, period, mxnRate, giftCard, collected = 0) {
  const candidates = [6, 7, 8].map((hours) => {
    const lower = planForPayout(hours, period.workdays, minTarget, mxnRate, giftCard);
    const upper = planForPayout(hours, period.workdays, maxTarget, mxnRate, giftCard);
    const minimumMore = Math.max(0, lower.collection - collected);
    const more = Math.max(0, upper.collection - collected);
    const daily = (amountLeft) => amountLeft === 0 ? 0 : period.remainingDays ? Math.ceil(amountLeft / period.remainingDays * 100) / 100 : null;
    const reference = Math.max(collected, upper.collection);
    const projected = payoutAtCollection(hours, period.workdays, reference, mxnRate, giftCard);
    return { hours, minTarget, maxTarget, minimumMore, more, minimumDaily: daily(minimumMore), daily: daily(more), collection: upper.collection, projectedPayout: projected.payout };
  });
  return candidates.reduce((best, plan) => !best || plan.more < best.more || (plan.more === best.more && plan.projectedPayout > best.projectedPayout) ? plan : best, null);
}

function setupPlannerBands(form) {
  const upper = clamp(Math.ceil(amount(form.payoutTargetMax.value, 40000) / 5000) * 5000, 20000, 100000);
  form.plannerBand.replaceChildren(...Array.from({ length: 17 }, (_, index) => {
    const max = 20000 + index * 5000;
    return Object.assign(document.createElement('option'), { value: String(max), textContent: `${mxnMoney(max - 5000)}–${mxnMoney(max)} MXN` });
  }));
  form.plannerBand.value = String(upper);
  form.payoutTargetMin.value = upper - 5000;
  form.payoutTargetMax.value = upper;
}

function mxnMoney(value) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(amount(value));
}

function plannerPeriod(form, now = new Date()) {
  const year = Number(form.plannerYear.value);
  const month = Number(form.plannerMonth.value);
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(month) || month < 0 || month > 11) return null;
  const date = new Date(year, month, 1);
  const current = monthKey(date) === monthKey(now);
  const override = current ? goalWorkdays(form) : null;
  return { date, current, ...workdayCounts(date, now, override) };
}

function resetPlannerPeriod(form, nextMonth = true) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + (nextMonth ? 1 : 0), 1);
  form.plannerMonth.replaceChildren(...Array.from({ length: 12 }, (_, month) => {
    const option = document.createElement('option');
    option.value = String(month);
    option.textContent = new Date(2026, month, 1).toLocaleDateString('en-US', { month: 'long' });
    return option;
  }));
  form.plannerMonth.value = String(date.getMonth());
  form.plannerYear.value = String(date.getFullYear());
}

function updateHoursPlanner(form) {
  const list = $('hoursRecommendationOptions');
  if (!list) return;
  const period = plannerPeriod(form);
  if (!period) {
    list.replaceChildren();
    $('plannerComparison').innerHTML = '';
    $('plannerGrowth').textContent = '';
    $('plannerWorkdays').textContent = 'Choose a valid year';
    $('plannerPeriodNote').textContent = '';
    return;
  }
  const { workdays, remainingDays } = period;
  $('plannerWorkdays').textContent = period.current ? `${remainingDays} days left · ${workdays} this month` : `${workdays} workdays`;
  $('plannerPeriodNote').textContent = period.current ? 'Uses your collections so far.' : 'Plan next month’s declaration.';
  $('plannerThisMonth').hidden = period.current;
  const minTarget = Math.max(0, amount(form.payoutTargetMin.value, defaults.payoutTargetMin));
  const maxTarget = Math.max(minTarget, amount(form.payoutTargetMax.value, defaults.payoutTargetMax));
  const mxnRate = Math.max(0.0001, form.currency.value === 'MXN' ? amount(form.currencyRate.value, data.rate) : amount(data.rate, defaults.rate));
  const giftCard = amount(form.giftCard.value);
  const collected = period.current ? amount(form.before.value) + amount(form.today.value) : 0;
  list.replaceChildren(...[[minTarget, maxTarget]].map(([min, max]) => {
    const plan = recommendPayoutRange(min, max, period, mxnRate, giftCard, collected);
    const button = document.createElement('article');
    button.className = 'hours-plan-option';
    const pace = plan.more === 0 ? 'Target reached' : plan.daily === null ? 'No workdays left' : `${money(plan.minimumDaily)}–${money(plan.daily)}/day USD`;
    const range = `${mxnMoney(min)}–${mxnMoney(max)} MXN`;
    button.title = `${money(plan.minimumMore)}–${money(plan.more)} USD still to collect. Hours are chosen for the upper target; tier jumps may exceed it. ${plan.hours * 5} hours/week.`;
    button.setAttribute('aria-label', `${range}: ${plan.hours} hours per day, ${plan.hours * 5} hours per week. ${pace}. ${button.title}`);
    button.innerHTML = `<div class="plan-heading"><strong>Least collection</strong><b>${plan.hours} h/day</b></div><span>${money(plan.more)} USD ${period.current ? 'more' : 'total'} · ${pace}</span>`;
    const reference = Math.max(collected, plan.collection);
    $('plannerCompareCaption').textContent = `At ${money(reference)} USD collected`;
    $('plannerComparison').innerHTML = [6, 7, 8].map((hours) => {
      const result = payoutAtCollection(hours, workdays, reference, mxnRate, giftCard);
      return `<tr${hours === plan.hours ? ' class="recommended-row"' : ''}><th scope="row">${hours} h/day</th><td>${mxnMoney(result.payout)}</td><td>${result.tier}${hours === 6 ? ' · cap L3' : ''}</td></tr>`;
    }).join('');
    const growth = plan.hours === 6 ? growthAlternative(workdays, reference, mxnRate, giftCard) : null;
    $('plannerGrowth').textContent = growth
      ? `More room to earn: ${growth.hours} h/day reaches ${growth.tier} at ${money(growth.collection)} USD. That pays ${mxnMoney(growth.payout)} MXN—${mxnMoney(growth.gain)} more than 6h at the same collection.`
      : `${plan.hours} h/day ${plan.hours > 6 ? 'avoids the Level 3 cap.' : 'needs less collection for this target.'}`;
    return button;
  }));
}

function snapshot() {
  ensureCurrentDate();
  const now = new Date();
  const workday = isWorkday(now);
  const { workdays: workdaysInMonth, remainingDays } = workdayCounts(now, now, data.workdaysOverride);
  const elapsedWorkdays = Math.min(workdaysInMonth, Math.max(0, workdaysInMonth - remainingDays + (workday ? 1 : 0)));
  const today = stagedToday ?? data.today;
  const collected = data.before + today;
  let tier = ['Base', 0, .0535];
  let next = 0;
  const availableTiers = data.hours <= 6 ? tiers.slice(0, maxTierForSixOrFewerHours) : tiers;
  for (const candidate of availableTiers) {
    const minimum = candidate[1] * data.hours * workdaysInMonth;
    if (collected >= minimum) tier = candidate;
    else { next = minimum - collected; break; }
  }
  const daily = remainingDays ? Math.max(0, (data.goal - data.before) / remainingDays) : Math.max(0, data.goal - collected);
  const todayLeft = workday ? Math.max(0, daily - today) : 0;
  return {
    now, collected, tier, next, workday, daily, todayLeft, remainingDays, workdaysInMonth, elapsedWorkdays,
    monthLeft: Math.max(0, data.goal - collected),
    today, todayProgress: workday ? (daily ? clamp(today / daily * 100, 0, 100) : (data.goal ? 100 : 0)) : (today ? 100 : 0)
  };
}

function trackStatus(view) {
  const originalDailyTarget = view.workdaysInMonth ? data.goal / view.workdaysInMonth : 0;
  if (!originalDailyTarget) return { label: 'On track', className: 'on-track' };
  const expectedCollected = originalDailyTarget * view.elapsedWorkdays;
  const daysFromTrack = (view.collected - expectedCollected) / originalDailyTarget;
  if (daysFromTrack >= 2) return { label: 'Ahead Track', className: 'ahead-track' };
  if (daysFromTrack >= 0) return { label: 'On track', className: 'on-track' };
  if (daysFromTrack > -4) return { label: 'Close To Track', className: 'close-track' };
  return { label: 'Behind Track', className: 'behind-track' };
}

function setProgress(id, percentage) {
  const bar = $(id);
  const value = clamp(Number(percentage) || 0, 0, 100);
  bar.style.setProperty('width', `${value.toFixed(2)}%`, 'important');
  bar.parentElement.setAttribute('role', 'progressbar');
  bar.parentElement.setAttribute('aria-valuemin', '0');
  bar.parentElement.setAttribute('aria-valuemax', '100');
  bar.parentElement.setAttribute('aria-valuenow', String(Math.round(value)));
}

function render() {
  const view = snapshot();
  $('monthLabel').textContent = view.now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  $('dailyAmount').textContent = money(view.daily);
  $('goalAmount').textContent = money(data.goal);
  $('nextTierAmount').textContent = money(view.next);
  $('daysLeft').textContent = view.remainingDays;
  $('payoutAmount').textContent = payoutMoney(view.collected * view.tier[2] + data.giftCard);
  $('todayLabel').textContent = view.workday ? 'Today' : `${view.now.toLocaleDateString('en-US', { weekday: 'long' })} bonus`;
  $('progressText').textContent = view.workday ? `${money(view.today)} of ${money(view.daily)}` : `${money(view.today)} extra`;
  setProgress('progressFill', view.todayProgress);
  $('todayButton').innerHTML = view.workday ? `${money(view.todayLeft)} remaining today <span>↗</span>` : 'No workday target today — add a bonus <span>↗</span>';
  $('collectedSummary').textContent = `${money(view.collected)} collected`;
  $('monthProgressPercent').textContent = `${data.goal ? Math.round(clamp(view.collected / data.goal * 100, 0, 100)) : 0}% of goal`;
  $('monthRemaining').textContent = `${money(view.monthLeft)} remaining`;
  setProgress('monthProgressFill', data.goal ? view.collected / data.goal * 100 : 0);
  const status = trackStatus(view);
  $('ratePill').textContent = status.label;
  $('ratePill').className = `pill ${status.className}`;
  $('currentTier').textContent = `${view.tier[0]} rate`;
  $('tierRate').textContent = `${(view.tier[2] * 100).toFixed(2)}%`;
  setProgress('tierProgressFill', view.next ? view.collected / (view.collected + view.next) * 100 : 100);
  $('tierCopy').textContent = view.next ? `${money(view.next)} more in collections to reach the next commission tier.` : 'You are at the highest available commission tier.';
  renderPayoutTiers(view);
}

function renderPayoutTiers(view) {
  const list = $('tierList');
  const levelThreeCap = data.hours <= 6;
  const cappedCommissionRate = tiers[maxTierForSixOrFewerHours - 1][2];
  const tiersToShow = tiers.slice(0, visibleTierCount);
  const rows = tiersToShow.map((tier) => {
    const [name, hourlyMinimum, commissionRate] = tier;
    const levelNumber = Number(name.replace('Level ', ''));
    const aboveScheduleCap = levelThreeCap && levelNumber > maxTierForSixOrFewerHours;
    const displayedCommissionRate = aboveScheduleCap ? cappedCommissionRate : commissionRate;
    const minimumCollection = hourlyMinimum * data.hours * view.workdaysInMonth;
    const row = document.createElement('article');
    row.className = `tier-list-row${view.tier[0] === name ? ' active' : ''}${aboveScheduleCap ? ' above-cap' : ''}`;
    const details = document.createElement('div');
    details.className = 'tier-list-details';
    const level = document.createElement('strong');
    level.textContent = name;
    const minimum = document.createElement('span');
    minimum.textContent = `${money(minimumCollection)} collection minimum`;
    details.append(level, minimum);
    if (levelThreeCap && levelNumber === maxTierForSixOrFewerHours) {
      const cap = document.createElement('span');
      cap.className = 'tier-cap-label';
      cap.textContent = 'Maximum at 6 or fewer hours/day';
      details.append(cap);
    }

    const payout = document.createElement('div');
    payout.className = 'tier-list-payout';
    const payoutAmount = document.createElement('strong');
    payoutAmount.textContent = payoutMoney(minimumCollection * displayedCommissionRate);
    const rate = document.createElement('span');
    rate.textContent = `${(displayedCommissionRate * 100).toFixed(2)}% commission`;
    payout.append(payoutAmount, rate);
    row.append(details, payout);
    return row;
  });
  list.replaceChildren(...rows);
  const expanded = visibleTierCount === tiers.length;
  $('tierCount').textContent = levelThreeCap
    ? 'Level 3 cap'
    : `${tiers.length} levels`;
  $('payoutTiersCopy').textContent = levelThreeCap
    ? 'Maximum commission level at 6 or fewer hours per day.'
    : 'All 10 levels are available above 6 hours per day.';
  $('tierListToggle').textContent = expanded ? '− Show only the first 5 levels' : 'Add 5 more levels +';
  $('tierListToggle').setAttribute('aria-expanded', String(expanded));
}

function parseExpression(value) {
  const terms = String(value ?? '').replace(/[^0-9.+-]/g, '').match(/[+-]?[0-9]+(?:\.[0-9]+)?/g) || [];
  return Math.max(0, terms.reduce((total, term) => total + (Number.parseFloat(term) || 0), 0));
}

function closeSettings() {
  $('settingsModal').hidden = true;
  $('settingsButton').focus();
}
function settingsStatus(message = 'Unsaved changes') { $('settingsStatus').textContent = message; }
function setSettingsEditor(id, expanded) {
  $(id).hidden = !expanded;
  const button = $(id === 'goalFields' ? 'editGoalButton' : 'editWorkdaysButton');
  button.textContent = expanded ? 'Done' : 'Edit';
  button.setAttribute('aria-expanded', String(expanded));
}
function automaticWorkdays(date = new Date()) {
  let count = 0;
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= days; day += 1) {
    if (isWorkday(new Date(date.getFullYear(), date.getMonth(), day))) count += 1;
  }
  return count;
}
function updateWorkdaysSummary() {
  const automaticCount = automaticWorkdays();
  const count = stagedWorkdaysOverride ?? automaticCount;
  $('workdaysSummary').textContent = `${count} · ${stagedWorkdaysOverride === null ? 'Auto' : 'Custom'}`;
  $('automaticWorkdaysButton').hidden = stagedWorkdaysOverride === null;
}
function goalWorkdays(form) {
  return $('workdaysFields').hidden
    ? (stagedWorkdaysOverride ?? automaticWorkdays())
    : clamp(Math.round(amount(form.workdays.value, automaticWorkdays())), 1, 31);
}
function updateGoalOptions(form) {
  const select = form.goalMode;
  const selectedValue = select.value || (data.goalMode === 'tier' ? `tier-${data.goalTier}` : 'custom');
  const hours = Math.max(.1, amount(form.hours.value, defaults.hours));
  const workdays = goalWorkdays(form);
  select.replaceChildren(...tiers.map((tier, index) => {
    const option = document.createElement('option');
    option.value = `tier-${index}`;
    option.textContent = `${tier[0]} — ${money(tierGoal(index, hours, workdays))}`;
    return option;
  }), Object.assign(document.createElement('option'), { value: 'custom', textContent: 'Custom amount' }));
  select.value = [...select.options].some((option) => option.value === selectedValue) ? selectedValue : 'custom';
  const tierIndex = Number(select.value.replace('tier-', ''));
  const isTier = Number.isInteger(tierIndex) && tierIndex >= 0 && tierIndex < tiers.length;
  $('customGoalField').hidden = isTier;
  $('tierGoalHint').hidden = !isTier;
  if (isTier) $('tierGoalHint').textContent = `${hours} h/day × ${workdays} days`;
}
function updateGoalSummary(form) {
  const selected = form.goalMode.value;
  const tierIndex = Number(selected.replace('tier-', ''));
  $('goalSummary').textContent = Number.isInteger(tierIndex) && tiers[tierIndex]
    ? `${tiers[tierIndex][0]} · ${money(tierGoal(tierIndex, form.hours.value, goalWorkdays(form)))}`
    : `Custom · ${money(form.goal.value)}`;
}
function selectedRate(form) {
  if (form.currency.value === 'USD') return 1;
  return amount(form.currencyRate.value, 1);
}
function refreshCurrencyFields(form, resetRate = false) {
  if (form.currency.value === 'USD') form.currencyRate.value = '1';
  if (form.currency.value === 'MXN' && resetRate) form.currencyRate.value = amount(data.rate).toFixed(4);
  $('exchangeRateField').hidden = form.currency.value === 'USD';
  form.currencyRate.required = form.currency.value !== 'USD';
  form.customCurrency.required = form.currency.value === 'CUSTOM';
  $('exchangeRateCurrency').textContent = form.currency.value === 'CUSTOM' ? form.customCurrency.value.toUpperCase() || 'EUR' : form.currency.value;
  $('customCurrencyFields').hidden = form.currency.value !== 'CUSTOM';
}
function openSettings() {
  const form = $('settingsForm');
  stagedWorkdaysOverride = data.workdaysOverride;
  form.currency.value = data.currency;
  form.customCurrency.value = data.customCurrency;
  form.currencyRate.value = payoutRate();
  form.goal.value = data.goal;
  form.before.value = data.before;
  form.today.value = data.today;
  form.hours.value = data.hours;
  form.giftCard.value = data.giftCard;
  form.payoutTargetMin.value = data.payoutTargetMin;
  form.payoutTargetMax.value = data.payoutTargetMax;
  setupPlannerBands(form);
  form.workdays.value = stagedWorkdaysOverride ?? automaticWorkdays();
  form.workdays.required = false;
  setSettingsEditor('workdaysFields', false);
  form.goalMode.value = data.goalMode === 'tier' ? `tier-${data.goalTier}` : 'custom';
  setSettingsEditor('goalFields', false);
  updateWorkdaysSummary();
  updateGoalOptions(form);
  updateGoalSummary(form);
  refreshCurrencyFields(form);
  resetPlannerPeriod(form);
  updateHoursPlanner(form);
  settingsStatus('');
  $('settingsModal').hidden = false;
  selectSettingsTab($('collectionsTab'));
  $('collectionsTab').focus();
}
function selectSettingsTab(selectedTab) {
  document.querySelectorAll('.settings-tabs [role="tab"]').forEach((tab) => {
    const selected = tab === selectedTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !selected;
  });
  document.querySelector('.settings-content').scrollTop = 0;
}
document.querySelectorAll('.settings-tabs [role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => selectSettingsTab(tab));
  tab.addEventListener('keydown', (event) => {
    const tabs = [...document.querySelectorAll('.settings-tabs [role="tab"]')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectSettingsTab(tabs[next]);
    tabs[next].focus();
  });
});
function closeTodayEditor(commit) {
  const editor = $('todayEditor');
  if (editor.style.display !== 'block') return;
  if (commit) {
    data.today = stagedToday ?? parseExpression(editor.value);
    data.day = dateKey(new Date());
    save();
  }
  stagedToday = null;
  editor.style.display = 'none';
  $('todayButton').style.display = 'flex';
  render();
}

$('settingsButton').addEventListener('click', openSettings);
$('closeModal').addEventListener('click', () => saveSettings($('settingsForm')));
$('cancelModal').addEventListener('click', closeSettings);
const markSettingsChanged = (event) => {
  if (!['plannerMonth', 'plannerYear'].includes(event.target.name)) settingsStatus();
};
$('settingsForm').addEventListener('input', markSettingsChanged);
$('settingsForm').addEventListener('change', markSettingsChanged);
$('settingsForm').customCurrency.addEventListener('input', (event) => {
  $('exchangeRateCurrency').textContent = event.currentTarget.value.toUpperCase() || 'EUR';
});
$('settingsForm').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSettings();
  }
  if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
    event.preventDefault();
    saveSettings(event.currentTarget);
  }
  if (event.key === 'Tab') {
    const focusable = [...event.currentTarget.querySelectorAll('button, input, select, [tabindex="0"]')]
      .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
$('settingsModal').addEventListener('click', (event) => {
  if (event.target === $('settingsModal')) saveSettings($('settingsForm'));
});
$('settingsForm').currency.addEventListener('change', (event) => {
  refreshCurrencyFields(event.currentTarget.form, true);
  updateHoursPlanner(event.currentTarget.form);
});
$('editGoalButton').addEventListener('click', () => {
  const form = $('settingsForm');
  const expand = $('goalFields').hidden;
  setSettingsEditor('goalFields', expand);
  updateGoalOptions(form);
  if (expand) form.goalMode.focus();
});
$('settingsForm').goalMode.addEventListener('change', (event) => {
  updateGoalOptions(event.currentTarget.form);
  updateGoalSummary(event.currentTarget.form);
});
$('settingsForm').goal.addEventListener('input', (event) => updateGoalSummary(event.currentTarget.form));
$('settingsForm').hours.addEventListener('input', (event) => {
  updateGoalOptions(event.currentTarget.form);
  updateGoalSummary(event.currentTarget.form);
  updateHoursPlanner(event.currentTarget.form);
});
['plannerMonth', 'plannerYear'].forEach((field) => {
  $('settingsForm')[field].addEventListener('input', (event) => updateHoursPlanner(event.currentTarget.form));
});
$('settingsForm').plannerBand.addEventListener('change', (event) => {
  const form = event.currentTarget.form;
  form.payoutTargetMax.value = Number(event.currentTarget.value);
  form.payoutTargetMin.value = Number(event.currentTarget.value) - 5000;
  updateHoursPlanner(form);
});
$('plannerThisMonth').addEventListener('click', () => {
  const form = $('settingsForm');
  resetPlannerPeriod(form, false);
  updateHoursPlanner(form);
});
['payoutTargetMin', 'payoutTargetMax', 'giftCard', 'currencyRate', 'before', 'today'].forEach((field) => {
  $('settingsForm')[field].addEventListener('input', (event) => updateHoursPlanner(event.currentTarget.form));
});
$('editWorkdaysButton').addEventListener('click', () => {
  const form = $('settingsForm');
  if (!$('workdaysFields').hidden) {
    if (!form.workdays.reportValidity()) return;
    stagedWorkdaysOverride = goalWorkdays(form);
    setSettingsEditor('workdaysFields', false);
    updateWorkdaysSummary();
    settingsStatus();
    return;
  }
  form.workdays.value = stagedWorkdaysOverride ?? automaticWorkdays();
  setSettingsEditor('workdaysFields', true);
  $('automaticWorkdaysButton').hidden = false;
  form.workdays.required = true;
  updateGoalOptions(form);
  updateGoalSummary(form);
  updateHoursPlanner(form);
  form.workdays.focus();
});
$('settingsForm').workdays.addEventListener('input', (event) => {
  const form = event.currentTarget.form;
  const count = clamp(Math.round(amount(event.currentTarget.value)), 1, 31);
  $('workdaysSummary').textContent = `${count} · Custom`;
  updateGoalOptions(form);
  updateGoalSummary(form);
  updateHoursPlanner(form);
});
$('automaticWorkdaysButton').addEventListener('click', () => {
  const form = $('settingsForm');
  stagedWorkdaysOverride = null;
  setSettingsEditor('workdaysFields', false);
  form.workdays.required = false;
  updateWorkdaysSummary();
  updateGoalOptions(form);
  updateGoalSummary(form);
  updateHoursPlanner(form);
  settingsStatus();
});
function saveSettings(form) {
  const invalid = [...form.elements].find((element) => element.willValidate && !element.validity.valid);
  if (invalid) {
    const panel = invalid.closest('[role="tabpanel"]');
    if (panel) selectSettingsTab($(panel.getAttribute('aria-labelledby')));
    settingsStatus('Check the highlighted field');
    invalid.reportValidity();
    return;
  }
  const currencyRate = selectedRate(form);
  data.currency = form.currency.value;
  data.customCurrency = /^[A-Za-z]{3}$/.test(form.customCurrency.value) ? form.customCurrency.value.toUpperCase() : defaults.customCurrency;
  data.currencyRate = currencyRate;
  const selectedGoalTier = Number(form.goalMode.value.replace('tier-', ''));
  const goalUsesTier = Number.isInteger(selectedGoalTier) && selectedGoalTier >= 0 && selectedGoalTier < tiers.length;
  const submittedWorkdays = !$('workdaysFields').hidden
    ? clamp(Math.round(amount(form.workdays.value, automaticWorkdays())), 1, 31)
    : (stagedWorkdaysOverride ?? automaticWorkdays());
  data.goalMode = goalUsesTier ? 'tier' : 'custom';
  data.goalTier = goalUsesTier ? selectedGoalTier : null;
  data.goal = goalUsesTier ? tierGoal(selectedGoalTier, form.hours.value, submittedWorkdays) : amount(form.goal.value);
  data.before = amount(form.before.value);
  data.today = amount(form.today.value);
  data.hours = Math.min(8, Math.max(.1, amount(form.hours.value, defaults.hours)));
  data.giftCard = amount(form.giftCard.value);
  data.payoutTargetMin = Math.max(0, amount(form.payoutTargetMin.value, defaults.payoutTargetMin));
  data.payoutTargetMax = Math.max(data.payoutTargetMin, amount(form.payoutTargetMax.value, defaults.payoutTargetMax));
  if (!$('workdaysFields').hidden) stagedWorkdaysOverride = submittedWorkdays;
  data.workdaysOverride = stagedWorkdaysOverride;
  data.workdaysOverrideMonth = stagedWorkdaysOverride === null ? '' : monthKey(new Date());
  data.month = monthKey(new Date());
  data.day = dateKey(new Date());
  save();
  closeSettings();
  stagedWorkdaysOverride = null;
  render();
}

$('settingsForm').addEventListener('submit', (event) => {
  event.preventDefault();
  saveSettings(event.currentTarget);
});
$('todayButton').addEventListener('click', () => {
  const editor = $('todayEditor');
  stagedToday = data.today;
  $('todayButton').style.display = 'none';
  editor.style.display = 'block';
  editor.value = `${data.today}+`;
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
});
$('todayEditor').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); closeTodayEditor(true); }
  if (event.key === 'Escape') { event.preventDefault(); closeTodayEditor(false); }
});
$('todayEditor').addEventListener('input', (event) => {
  stagedToday = parseExpression(event.currentTarget.value);
  render();
});
$('todayEditor').addEventListener('blur', () => closeTodayEditor(true));
$('tierListToggle').addEventListener('click', () => {
  visibleTierCount = visibleTierCount === 5 ? tiers.length : 5;
  render();
});

render();
