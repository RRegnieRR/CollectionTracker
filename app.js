const KEY = 'collection-tracker-web-v1';
const defaults = { goal: 0, before: 0, today: 0, hours: 6, rate: 18, month: '', day: '', webInitialised: false };
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
  return {
    ...defaults,
    ...values,
    goal: amount(values.goal),
    before: amount(values.before),
    today: amount(values.today),
    hours: Math.max(0.1, amount(values.hours, defaults.hours)),
    rate: Math.max(0.01, amount(values.rate, defaults.rate))
  };
}

let data = normalise({ ...defaults, ...readData() });
let stagedToday = null;
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount(value));
const mxn = (value) => 'MX$' + new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount(value));
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
    data.month = currentMonth;
    data.day = currentDay;
    save();
  } else if (data.day !== currentDay) {
    data.before += data.today;
    data.today = 0;
    data.day = currentDay;
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
  return [
    observedFixed(year, 0, 1), observedFixed(year, 5, 19), observedFixed(year, 6, 4), observedFixed(year, 10, 11), observedFixed(year, 11, 25),
    nth(year, 0, 1, 3), nth(year, 1, 1, 3), last(year, 4, 1), nth(year, 8, 1, 1), nth(year, 9, 1, 2), nth(year, 10, 4, 4)
  ].map(dateKey);
}
function isWorkday(date) {
  return date.getDay() !== 0 && date.getDay() !== 6 && !holidays(date.getFullYear()).includes(dateKey(date));
}

const tiers = [
  ['Level 1', 133, .0635], ['Level 2', 158, .0685], ['Level 3', 180, .0735], ['Level 4', 208, .0785], ['Level 5', 233, .0835],
  ['Level 6', 258, .0885], ['Level 7', 283, .0935], ['Level 8', 308, .0985], ['Level 9', 333, .1035], ['Level 10', 358, .1085]
];

function snapshot() {
  ensureCurrentDate();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  let remainingDays = 0;
  let workdaysInMonth = 0;
  for (let day = 1; day <= days; day += 1) {
    if (isWorkday(new Date(year, month, day))) {
      workdaysInMonth += 1;
      if (day >= now.getDate()) remainingDays += 1;
    }
  }
  const today = stagedToday ?? data.today;
  const collected = data.before + today;
  let tier = ['Base', 0, .0535];
  let next = 0;
  for (const candidate of tiers) {
    const minimum = candidate[1] * data.hours * workdaysInMonth;
    if (collected >= minimum) tier = candidate;
    else { next = minimum - collected; break; }
  }
  const workday = isWorkday(now);
  const daily = remainingDays ? Math.max(0, (data.goal - data.before) / remainingDays) : Math.max(0, data.goal - collected);
  const todayLeft = workday ? Math.max(0, daily - today) : 0;
  return {
    now, collected, tier, next, workday, daily, todayLeft, remainingDays,
    monthLeft: Math.max(0, data.goal - collected),
    today, todayProgress: workday ? (daily ? clamp(today / daily * 100, 0, 100) : (data.goal ? 100 : 0)) : (today ? 100 : 0)
  };
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
  $('payoutAmount').textContent = mxn(view.collected * view.tier[2] * data.rate);
  $('todayLabel').textContent = view.workday ? 'Today' : `${view.now.toLocaleDateString('en-US', { weekday: 'long' })} bonus`;
  $('progressText').textContent = view.workday ? `${money(view.today)} of ${money(view.daily)}` : `${money(view.today)} extra`;
  setProgress('progressFill', view.todayProgress);
  $('todayButton').innerHTML = view.workday ? `${money(view.todayLeft)} remaining today <span>↗</span>` : 'No workday target today — add a bonus <span>↗</span>';
  $('collectedSummary').textContent = `${money(view.collected)} collected`;
  $('monthProgressPercent').textContent = `${data.goal ? Math.round(clamp(view.collected / data.goal * 100, 0, 100)) : 0}% of goal`;
  $('monthRemaining').textContent = `${money(view.monthLeft)} remaining`;
  setProgress('monthProgressFill', data.goal ? view.collected / data.goal * 100 : 0);
  $('ratePill').textContent = `${(view.tier[2] * 100).toFixed(2)}%`;
  $('currentTier').textContent = `${view.tier[0]} rate`;
  $('tierRate').textContent = `${(view.tier[2] * 100).toFixed(2)}%`;
  setProgress('tierProgressFill', view.next ? view.collected / (view.collected + view.next) * 100 : 100);
  $('tierCopy').textContent = view.next ? `${money(view.next)} more in collections to reach the next commission tier.` : 'You are at the highest available commission tier.';
}

function parseExpression(value) {
  const terms = String(value ?? '').replace(/[^0-9.+-]/g, '').match(/[+-]?[0-9]+(?:\.[0-9]+)?/g) || [];
  return Math.max(0, terms.reduce((total, term) => total + (Number.parseFloat(term) || 0), 0));
}

function closeSettings() { $('settingsModal').hidden = true; }
function openSettings() {
  const form = $('settingsForm');
  form.goal.value = data.goal;
  form.before.value = data.before;
  form.today.value = data.today;
  form.hours.value = data.hours;
  $('settingsModal').hidden = false;
  form.goal.focus();
}
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
$('closeModal').addEventListener('click', closeSettings);
$('cancelModal').addEventListener('click', closeSettings);
$('settingsModal').addEventListener('click', (event) => { if (event.target === $('settingsModal')) closeSettings(); });
$('settingsForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  data.goal = amount(form.goal.value);
  data.before = amount(form.before.value);
  data.today = amount(form.today.value);
  data.hours = Math.max(.1, amount(form.hours.value, defaults.hours));
  data.month = monthKey(new Date());
  data.day = dateKey(new Date());
  save();
  closeSettings();
  render();
});
$('todayButton').addEventListener('click', () => {
  const editor = $('todayEditor');
  stagedToday = data.today;
  $('todayButton').style.display = 'none';
  editor.style.display = 'block';
  editor.value = data.today;
  editor.focus();
  editor.select();
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
$('resetButton').addEventListener('click', () => {
  if (confirm('Reset all collection data?')) {
    data = normalise({ ...defaults, webInitialised: true });
    data.month = monthKey(new Date());
    data.day = dateKey(new Date());
    save();
    render();
  }
});

render();
