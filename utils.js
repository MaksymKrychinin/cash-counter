// Shared helpers for the app (app.js) and the admin dashboard (admin.js).
import { CURRENCIES } from './db.js';

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Невірний email або пароль.',
  'auth/invalid-email': 'Невірний формат email.',
  'auth/user-disabled': 'Цей акаунт вимкнено.',
  'auth/too-many-requests': 'Забагато спроб. Спробуйте пізніше.',
  'auth/network-request-failed': "Немає з'єднання з інтернетом. Перший вхід потребує інтернету.",
};

/** @param {unknown} err @returns {string} */
export const authErrorMessage = (err) =>
  AUTH_ERRORS[err && err.code] || 'Не вдалося увійти. Спробуйте ще раз.';

export const pad = (n) => String(n).padStart(2, '0');

/** @returns {string} today as YYYY-MM-DD in local time */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** @param {string} iso YYYY-MM-DD @returns {string} YYYY-MM */
export const monthKey = (iso) => iso.slice(0, 7);

/** @param {string} key YYYY-MM @param {number} delta @returns {string} YYYY-MM */
export const shiftMonth = (key, delta) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/** @param {string} key YYYY-MM @returns {{ start: string, end: string }} start inclusive, end exclusive */
export const monthRange = (key) => ({ start: `${key}-01`, end: `${shiftMonth(key, 1)}-01` });

/** @param {number} n @returns {string} */
export const fmt = (n) => n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** @param {string} key YYYY-MM @returns {string} e.g. "жовтень 2026" */
export const fmtMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
    .replace(/\s*р\.$/, '');
};

/** @param {string} iso YYYY-MM-DD @returns {string} e.g. "5 жовт." */
export const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
};

/** @param {string} tag @param {string} [text] @param {string} [className] @returns {HTMLElement} */
export const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (className) n.className = className;
  return n;
};

/**
 * @param {{ currency: string, kind: 'required'|'optional', amount: number }[]} entries
 * @returns {Record<string, { required: number, optional: number }>}
 */
export const sumByCurrency = (entries) => entries.reduce((acc, e) => {
  const cur = acc[e.currency] || { required: 0, optional: 0 };
  return { ...acc, [e.currency]: { ...cur, [e.kind]: cur[e.kind] + e.amount } };
}, {});

/**
 * Table: one row per currency with required / optional / total.
 * @param {Record<string, { required: number, optional: number }>} sums
 * @returns {HTMLTableElement}
 */
export const totalsTable = (sums) => {
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
  return table;
};
