// UI layer. Data lives in Firestore (see db.js); this file only renders and reacts.
import {
  CURRENCIES, isConfigured, watchAuth, login, logout, watchRange,
  saveEntry, removeEntry, fetchAll, importEntries,
} from './db.js';

const DEFAULT_CURRENCY = 'PLN';
const LEGACY_KEY = 'cash-calc.v1'; // records saved by the localStorage-only version
const KIND_LABELS = { required: "Обов'язковий", optional: "Необов'язковий" };
const AUTH_ERRORS = {
  'auth/invalid-credential': 'Невірний email або пароль.',
  'auth/invalid-email': 'Невірний формат email.',
  'auth/user-disabled': 'Цей акаунт вимкнено.',
  'auth/too-many-requests': 'Забагато спроб. Спробуйте пізніше.',
  'auth/network-request-failed': "Немає з'єднання з інтернетом. Перший вхід потребує інтернету.",
};

const $ = (id) => document.getElementById(id);
const el = {
  setupScreen: $('setupScreen'), loginScreen: $('loginScreen'), appScreen: $('appScreen'),
  loginForm: $('loginForm'), loginEmail: $('loginEmail'), loginPassword: $('loginPassword'),
  loginBtn: $('loginBtn'), loginError: $('loginError'),
  userEmail: $('userEmail'), logoutBtn: $('logoutBtn'), syncStatus: $('syncStatus'),
  form: $('form'), formTitle: $('formTitle'), amount: $('amount'), currency: $('currency'),
  name: $('name'), date: $('date'), submitBtn: $('submitBtn'), cancelEdit: $('cancelEdit'),
  monthTitle: $('monthTitle'), prevMonth: $('prevMonth'), nextMonth: $('nextMonth'),
  totals: $('totals'), list: $('list'),
  exportBtn: $('exportBtn'), importBtn: $('importBtn'), importFile: $('importFile'),
};

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthKey = (iso) => iso.slice(0, 7);
const shiftMonth = (key, delta) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2));
const parseAmount = (raw) => {
  const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const fmt = (n) => n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
    .replace(/\s*р\.$/, '');
};
const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
};
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (className) n.className = className;
  return n;
};

// ---------- state ----------
let state = {
  user: null,
  month: monthKey(todayISO()),
  entries: [],
  sync: { pending: false, fromCache: true },
  editingId: null,
};
let unsubscribeMonth = null;

const setState = (patch) => {
  state = { ...state, ...patch };
  render();
};

const subscribeMonth = () => {
  if (unsubscribeMonth) unsubscribeMonth();
  unsubscribeMonth = null;
  if (!state.user) return;
  const start = `${state.month}-01`;
  const end = `${shiftMonth(state.month, 1)}-01`;
  unsubscribeMonth = watchRange(state.user.uid, start, end,
    (entries, sync) => setState({ entries, sync }),
    (err) => {
      console.error('Помилка читання з Firestore', err);
      alert('Не вдалося завантажити записи. Перевірте інтернет та правила Firestore.');
    });
};

const changeMonth = (month) => {
  setState({ month, entries: [] });
  subscribeMonth();
};

const reportWriteError = (err) => {
  console.error('Помилка запису в Firestore', err);
  alert('Сервер відхилив зміну. Запис не збережено — перевірте дані або правила Firestore.');
};

// ---------- auth ----------
const migrateLocalData = async (uid) => {
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch { legacy = null; }
  if (!Array.isArray(legacy) || legacy.length === 0) return;
  try {
    const { added } = await importEntries(uid, legacy);
    localStorage.removeItem(LEGACY_KEY);
    if (added > 0) alert(`Перенесено в хмару записів з пристрою: ${added}.`);
  } catch (err) {
    console.error('Не вдалося перенести локальні записи', err);
  }
};

el.loginForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  el.loginError.textContent = '';
  el.loginBtn.disabled = true;
  try {
    await login(el.loginEmail.value.trim(), el.loginPassword.value);
    el.loginForm.reset();
  } catch (err) {
    console.error('Вхід не вдався', err);
    el.loginError.textContent = AUTH_ERRORS[err && err.code] || 'Не вдалося увійти. Спробуйте ще раз.';
  } finally {
    el.loginBtn.disabled = false;
  }
});

el.logoutBtn.addEventListener('click', async () => {
  if (!confirm('Вийти з акаунту?')) return;
  try {
    await logout();
  } catch (err) {
    console.error('Вихід не вдався', err);
    alert('Не вдалося вийти.');
  }
});

// ---------- entry form ----------
el.currency.append(...CURRENCIES.map((c) => new Option(c, c)));

const resetForm = () => {
  el.form.reset();
  el.currency.value = DEFAULT_CURRENCY;
  el.date.value = todayISO();
  el.form.classList.remove('editing');
  el.formTitle.textContent = 'Новий платіж';
  el.submitBtn.textContent = 'Додати';
};

const fillForm = (entry) => {
  el.amount.value = String(entry.amount).replace('.', ',');
  el.currency.value = entry.currency;
  el.name.value = entry.name;
  el.form.kind.value = entry.kind;
  el.date.value = entry.date;
  el.form.classList.add('editing');
  el.formTitle.textContent = 'Редагувати платіж';
  el.submitBtn.textContent = 'Зберегти';
  el.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const readForm = () => {
  const amount = parseAmount(el.amount.value);
  const name = el.name.value.trim();
  const date = el.date.value;
  if (amount === null) return { error: 'Введіть суму більше нуля.', field: el.amount };
  if (!name) return { error: 'Введіть назву платежу.', field: el.name };
  if (!date) return { error: 'Оберіть дату.', field: el.date };
  return { value: { name, amount, date, currency: el.currency.value, kind: el.form.kind.value } };
};

el.form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const { value, error, field } = readForm();
  if (error) { field.focus(); alert(error); return; }

  const entry = { id: state.editingId || newId(), ...value };
  // Not awaited: offline the write is queued and shows up instantly via the listener
  saveEntry(state.user.uid, entry).catch(reportWriteError);
  resetForm();
  setState({ editingId: null });
  if (monthKey(entry.date) !== state.month) changeMonth(monthKey(entry.date));
});

el.cancelEdit.addEventListener('click', () => {
  resetForm();
  setState({ editingId: null });
});

el.prevMonth.addEventListener('click', () => changeMonth(shiftMonth(state.month, -1)));
el.nextMonth.addEventListener('click', () => changeMonth(shiftMonth(state.month, 1)));

el.list.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const entry = state.entries.find((e) => e.id === btn.dataset.id);
  if (!entry) return;

  if (btn.dataset.action === 'edit') {
    fillForm(entry);
    setState({ editingId: entry.id });
    return;
  }
  if (!confirm(`Видалити «${entry.name}» (${fmt(entry.amount)} ${entry.currency})?`)) return;
  if (state.editingId === entry.id) {
    resetForm();
    setState({ editingId: null });
  }
  removeEntry(state.user.uid, entry.id).catch(reportWriteError);
});

// ---------- backup ----------
const shareOrDownload = async (file) => {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: file.name });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

el.exportBtn.addEventListener('click', async () => {
  try {
    const entries = await fetchAll(state.user.uid);
    const payload = JSON.stringify({
      app: 'cash-calc', version: 1, exportedAt: new Date().toISOString(), entries,
    }, null, 2);
    await shareOrDownload(new File([payload], `vytraty-${todayISO()}.json`, { type: 'application/json' }));
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user closed the share sheet
    console.error('Експорт не вдався', err);
    alert('Не вдалося експортувати дані.');
  }
});

el.importBtn.addEventListener('click', () => el.importFile.click());
el.importFile.addEventListener('change', async () => {
  const file = el.importFile.files && el.importFile.files[0];
  el.importFile.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed && parsed.entries;
    if (!Array.isArray(incoming)) throw new Error('entries array missing');
    const { added, skipped } = await importEntries(state.user.uid, incoming);
    alert(`Імпорт завершено. Додано: ${added}. Пропущено (вже є або некоректні): ${skipped}.`);
  } catch (err) {
    console.error('Імпорт не вдався', err);
    alert('Не вдалося імпортувати. Оберіть JSON-файл, створений експортом.');
  }
});

// ---------- render ----------
const sumByCurrency = (entries) => entries.reduce((acc, e) => {
  const cur = acc[e.currency] || { required: 0, optional: 0 };
  return { ...acc, [e.currency]: { ...cur, [e.kind]: cur[e.kind] + e.amount } };
}, {});

const renderTotals = () => {
  if (state.entries.length === 0) {
    el.totals.replaceChildren(node('p', 'Немає витрат за цей місяць', 'empty'));
    return;
  }
  const sums = sumByCurrency(state.entries);
  const head = node('tr');
  head.append(node('th', 'Валюта'), node('th', "Обов'язкові", 'req'),
    node('th', "Необов'язкові", 'opt'), node('th', 'Разом'));
  const rows = CURRENCIES.filter((c) => sums[c]).map((c) => {
    const { required, optional } = sums[c];
    const tr = node('tr');
    tr.append(node('td', c), node('td', fmt(required), 'req'),
      node('td', fmt(optional), 'opt'), node('td', fmt(required + optional), 'sum'));
    return tr;
  });
  const table = node('table', '', 'totals');
  table.append(node('thead'), node('tbody'));
  table.tHead.append(head);
  table.tBodies[0].append(...rows);
  el.totals.replaceChildren(table);
};

const renderItem = (e) => {
  const main = node('div', '', 'item-main');
  const meta = node('div', `${fmtDay(e.date)} · `, 'item-meta');
  meta.append(node('span', KIND_LABELS[e.kind], e.kind === 'required' ? 'req' : 'opt'));
  main.append(node('div', e.name, 'item-name'), meta);

  const actions = node('div', '', 'item-actions');
  [['edit', '✏️', 'Редагувати'], ['delete', '🗑️', 'Видалити']].forEach(([action, icon, label]) => {
    const b = node('button', icon);
    b.type = 'button';
    b.dataset.action = action;
    b.dataset.id = e.id;
    b.setAttribute('aria-label', label);
    actions.append(b);
  });

  const li = node('li');
  li.append(main, node('div', `${fmt(e.amount)} ${e.currency}`, 'item-amount'), actions);
  return li;
};

const renderList = () => {
  if (state.entries.length === 0) {
    el.list.replaceChildren(node('li', 'Записів немає', 'empty'));
    return;
  }
  el.list.replaceChildren(...state.entries.map(renderItem));
};

const renderSync = () => {
  const { pending, fromCache } = state.sync;
  const [text, cls] = pending ? ['⏳ Очікує синхронізації', 'pending']
    : fromCache ? ['☁︎ Офлайн — збережено на пристрої', 'offline']
      : ['✓ Синхронізовано', 'ok'];
  el.syncStatus.textContent = text;
  el.syncStatus.className = `sync ${cls}`;
};

const render = () => {
  el.setupScreen.hidden = isConfigured;
  el.loginScreen.hidden = !isConfigured || Boolean(state.user);
  el.appScreen.hidden = !state.user;
  if (!state.user) return;
  el.userEmail.textContent = state.user.email || '';
  el.monthTitle.textContent = fmtMonth(state.month);
  renderSync();
  renderTotals();
  renderList();
};

// ---------- start ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW registration failed', err));
}

resetForm();
render();

if (isConfigured) {
  watchAuth((user) => {
    resetForm();
    setState({ user, entries: [], editingId: null });
    subscribeMonth();
    if (user) migrateLocalData(user.uid);
  });
}
