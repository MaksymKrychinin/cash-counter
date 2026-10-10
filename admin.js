// Admin dashboard: monthly spending of every user. Read-only.
import {
  isConfigured, watchAuth, login, logout, checkIsAdmin, fetchProfiles, fetchAllUsersEntries,
} from './db.js';
import {
  authErrorMessage, todayISO, monthKey, shiftMonth, monthRange, fmtMonth, node,
  sumByCurrency, totalsTable,
} from './utils.js';

const $ = (id) => document.getElementById(id);
const el = {
  setupScreen: $('setupScreen'), loginScreen: $('loginScreen'), deniedScreen: $('deniedScreen'),
  dashScreen: $('dashScreen'), loginForm: $('loginForm'), loginEmail: $('loginEmail'),
  loginPassword: $('loginPassword'), loginBtn: $('loginBtn'), loginError: $('loginError'),
  deniedEmail: $('deniedEmail'), deniedLogout: $('deniedLogout'),
  userEmail: $('userEmail'), logoutBtn: $('logoutBtn'),
  monthTitle: $('monthTitle'), prevMonth: $('prevMonth'), nextMonth: $('nextMonth'),
  statActive: $('statActive'), statUsers: $('statUsers'), statEntries: $('statEntries'),
  overallTotals: $('overallTotals'), loadError: $('loadError'), refreshBtn: $('refreshBtn'),
  userCards: $('userCards'), inactive: $('inactive'),
};

let state = {
  user: null,
  isAdmin: false,
  month: monthKey(todayISO()),
  profiles: [],
  entries: [],
  loading: false,
  error: '',
};
let loadToken = 0; // ignore responses from an older month if the admin clicks quickly

const setState = (patch) => {
  state = { ...state, ...patch };
  render();
};

const loadErrorMessage = (err) => {
  if (err && err.code === 'permission-denied') return 'Немає доступу. Перевірте правила Firestore та документ admins/{uid}.';
  if (err && err.code === 'failed-precondition') return 'Потрібен індекс для entries.date (див. README). Посилання на створення — у консолі браузера.';
  return "Не вдалося завантажити дані. Перевірте з'єднання.";
};

const loadMonth = async () => {
  const token = ++loadToken;
  setState({ loading: true, error: '' });
  try {
    const { start, end } = monthRange(state.month);
    const [profiles, entries] = await Promise.all([fetchProfiles(), fetchAllUsersEntries(start, end)]);
    if (token === loadToken) setState({ profiles, entries, loading: false });
  } catch (err) {
    console.error('Помилка завантаження адмін-даних', err);
    if (token === loadToken) setState({ loading: false, error: loadErrorMessage(err) });
  }
};

const changeMonth = (delta) => {
  setState({ month: shiftMonth(state.month, delta), entries: [] });
  loadMonth();
};

// ---------- events ----------
el.loginForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  el.loginError.textContent = '';
  el.loginBtn.disabled = true;
  try {
    await login(el.loginEmail.value.trim(), el.loginPassword.value);
    el.loginForm.reset();
  } catch (err) {
    console.error('Вхід не вдався', err);
    el.loginError.textContent = authErrorMessage(err);
  } finally {
    el.loginBtn.disabled = false;
  }
});

const handleLogout = () => logout().catch((err) => {
  console.error('Вихід не вдався', err);
  alert('Не вдалося вийти.');
});
el.logoutBtn.addEventListener('click', handleLogout);
el.deniedLogout.addEventListener('click', handleLogout);
el.prevMonth.addEventListener('click', () => changeMonth(-1));
el.nextMonth.addEventListener('click', () => changeMonth(1));
el.refreshBtn.addEventListener('click', loadMonth);

// ---------- render ----------
/** Group the month's entries per user, most active first. */
const buildUserRows = () => {
  const byUid = state.entries.reduce((acc, e) => ({ ...acc, [e.uid]: [...(acc[e.uid] || []), e] }), {});
  const profileByUid = Object.fromEntries(state.profiles.map((p) => [p.uid, p]));
  // Users that have entries but no profile yet (never opened the new app version)
  const uids = [...new Set([...state.profiles.map((p) => p.uid), ...Object.keys(byUid)])];
  return uids
    .map((uid) => ({
      uid,
      email: (profileByUid[uid] && profileByUid[uid].email) || `uid: ${uid.slice(0, 8)}…`,
      lastSeen: profileByUid[uid] ? profileByUid[uid].lastSeen : null,
      entries: byUid[uid] || [],
    }))
    .sort((a, b) => b.entries.length - a.entries.length || a.email.localeCompare(b.email));
};

const fmtLastSeen = (date) => (date
  ? `був(ла) ${date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}`
  : '');

const renderUserCard = (row) => {
  const head = node('div', '', 'user-head');
  head.append(node('div', row.email, 'user-email'),
    node('div', `${row.entries.length} зап. ${fmtLastSeen(row.lastSeen)}`.trim(), 'user-meta'));
  const card = node('section', '', 'card');
  card.append(head, totalsTable(sumByCurrency(row.entries)));
  return card;
};

const renderInactive = (rows) => {
  if (rows.length === 0) {
    el.inactive.replaceChildren();
    return;
  }
  const card = node('section', '', 'card');
  const list = node('ul', '', 'list');
  list.append(...rows.map((r) => {
    const li = node('li');
    li.append(node('div', r.email, 'item-main'), node('div', fmtLastSeen(r.lastSeen), 'user-meta'));
    return li;
  }));
  card.append(node('h2', 'Без витрат цього місяця'), list);
  el.inactive.replaceChildren(card);
};

const renderDashboard = () => {
  const rows = buildUserRows();
  const active = rows.filter((r) => r.entries.length > 0);
  el.userEmail.textContent = state.user.email || '';
  el.monthTitle.textContent = fmtMonth(state.month);
  el.statActive.textContent = state.loading ? '…' : String(active.length);
  el.statUsers.textContent = state.loading ? '…' : String(rows.length);
  el.statEntries.textContent = state.loading ? '…' : String(state.entries.length);
  el.loadError.textContent = state.error;
  el.refreshBtn.disabled = state.loading;
  el.refreshBtn.textContent = state.loading ? 'Завантаження…' : 'Оновити';
  el.overallTotals.replaceChildren(state.entries.length > 0
    ? totalsTable(sumByCurrency(state.entries))
    : node('p', state.loading ? 'Завантаження…' : 'Немає витрат за цей місяць', 'empty'));
  el.userCards.replaceChildren(...active.map(renderUserCard));
  renderInactive(rows.filter((r) => r.entries.length === 0));
};

const render = () => {
  const signedIn = Boolean(state.user);
  el.setupScreen.hidden = isConfigured;
  el.loginScreen.hidden = !isConfigured || signedIn;
  el.deniedScreen.hidden = !signedIn || state.isAdmin;
  el.dashScreen.hidden = !signedIn || !state.isAdmin;
  if (signedIn && !state.isAdmin) el.deniedEmail.textContent = state.user.email || '';
  if (signedIn && state.isAdmin) renderDashboard();
};

// ---------- start ----------
render();

if (isConfigured) {
  watchAuth(async (user) => {
    if (!user) {
      setState({ user: null, isAdmin: false, profiles: [], entries: [] });
      return;
    }
    let isAdmin = false;
    try {
      isAdmin = await checkIsAdmin(user.uid);
    } catch (err) {
      console.error('Не вдалося перевірити права адміністратора', err);
    }
    setState({ user, isAdmin });
    if (isAdmin) loadMonth();
  });
}
