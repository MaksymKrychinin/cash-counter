// Firebase layer: auth + Firestore. The only module that talks to Firebase.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, getDocs, query, where, orderBy, onSnapshot,
  serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/**
 * @typedef {'PLN'|'USD'|'EUR'|'UAH'|'USDT'} Currency
 * @typedef {'required'|'optional'} Kind
 * @typedef {{ id: string, name: string, amount: number, currency: Currency, kind: Kind, date: string }} Entry
 * @typedef {{ pending: boolean, fromCache: boolean }} SyncState
 */

export const CURRENCIES = ['PLN', 'USD', 'EUR', 'UAH', 'USDT'];
export const KINDS = ['required', 'optional'];
export const NAME_MAX = 120;
const BATCH_LIMIT = 500; // Firestore max writes per batch

export const isConfigured = !Object.values(firebaseConfig).some((v) => String(v).includes('REPLACE_ME'));

/**
 * @param {unknown} e
 * @returns {boolean}
 */
export const isValidEntry = (e) => Boolean(e) && typeof e === 'object'
  && typeof e.id === 'string' && e.id.length > 0
  && typeof e.name === 'string' && e.name.length > 0 && e.name.length <= NAME_MAX
  && typeof e.amount === 'number' && Number.isFinite(e.amount) && e.amount > 0
  && CURRENCIES.includes(e.currency)
  && KINDS.includes(e.kind)
  && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date);

const app = isConfigured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
// Offline cache in IndexedDB: the app works without internet and syncs later
const db = app ? initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
}) : null;

const entriesCol = (uid) => collection(db, 'users', uid, 'entries');

/** @param {Entry} e */
const toDoc = ({ name, amount, currency, kind, date }) => ({
  name, amount, currency, kind, date, updatedAt: serverTimestamp(),
});

/** @returns {Entry} */
const fromDoc = (d) => {
  const { name, amount, currency, kind, date } = d.data();
  return { id: d.id, name, amount, currency, kind, date };
};

/**
 * @param {(user: { uid: string, email: string | null } | null) => void} callback
 * @returns {() => void} unsubscribe
 */
export const watchAuth = (callback) => onAuthStateChanged(auth, callback);

/** @param {string} email @param {string} password @returns {Promise<unknown>} */
export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);

/** @returns {Promise<void>} */
export const logout = () => signOut(auth);

/**
 * Live subscription to entries with startDate <= date < endDate (ISO strings).
 * @param {string} uid
 * @param {string} startDate
 * @param {string} endDate
 * @param {(entries: Entry[], sync: SyncState) => void} onData
 * @param {(err: Error) => void} onError
 * @returns {() => void} unsubscribe
 */
export const watchRange = (uid, startDate, endDate, onData, onError) => {
  const q = query(entriesCol(uid),
    where('date', '>=', startDate), where('date', '<', endDate), orderBy('date', 'desc'));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    onData(snap.docs.map(fromDoc).filter(isValidEntry), {
      pending: snap.metadata.hasPendingWrites,
      fromCache: snap.metadata.fromCache,
    });
  }, onError);
};

/**
 * Create or replace an entry. Resolves once the server confirms; while offline
 * the write is queued and the UI already sees it via the snapshot listener.
 * @param {string} uid @param {Entry} entry @returns {Promise<void>}
 */
export const saveEntry = (uid, entry) => setDoc(doc(entriesCol(uid), entry.id), toDoc(entry));

/** @param {string} uid @param {string} id @returns {Promise<void>} */
export const removeEntry = (uid, id) => deleteDoc(doc(entriesCol(uid), id));

/** @param {string} uid @returns {Promise<Entry[]>} */
export const fetchAll = async (uid) => {
  const snap = await getDocs(entriesCol(uid));
  return snap.docs.map(fromDoc).filter(isValidEntry);
};

/**
 * Add entries whose ids don't exist yet. Never overwrites or deletes.
 * @param {string} uid @param {unknown[]} incoming
 * @returns {Promise<{ added: number, skipped: number }>}
 */
export const importEntries = async (uid, incoming) => {
  const known = new Set((await fetchAll(uid)).map((e) => e.id));
  const fresh = incoming.filter((e) => isValidEntry(e) && !known.has(e.id));
  const chunks = Array.from({ length: Math.ceil(fresh.length / BATCH_LIMIT) },
    (_, i) => fresh.slice(i * BATCH_LIMIT, (i + 1) * BATCH_LIMIT));
  await Promise.all(chunks.map((chunk) => {
    const batch = writeBatch(db);
    chunk.forEach((e) => batch.set(doc(entriesCol(uid), e.id), toDoc(e)));
    return batch.commit();
  }));
  return { added: fresh.length, skipped: incoming.length - fresh.length };
};
