import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

// ── Firebase is initialized with config from localStorage (set during setup) ──
let app, auth, db;

export function initFirebase(config) {
  try {
    app  = initializeApp(config, config.projectId);
    auth = getAuth(app);
    db   = getFirestore(app);
    return true;
  } catch (e) {
    // App already initialized with same name
    const { getApp } = require("firebase/app");
    app  = getApp(config.projectId);
    auth = getAuth(app);
    db   = getFirestore(app);
    return true;
  }
}

export function getFirebaseAuth() { return auth; }
export function getFirebaseDb()   { return db; }

// ── Auth ─────────────────────────────────────────────────────────────────────
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
  const result = await signInWithPopup(auth, provider);
  // Capture Gmail OAuth token for Gmail API calls
  const credential = GoogleAuthProvider.credentialFromResult(result);
  return { user: result.user, accessToken: credential?.accessToken || null };
}

export async function signOutUser() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ── Firestore helpers ─────────────────────────────────────────────────────────
// All user data lives under: /users/{uid}/...

function vaultCol(uid)        { return collection(db, "users", uid, "vault"); }
function recordsCol(uid)      { return collection(db, "users", uid, "records"); }
function settingsDoc(uid)     { return doc(db, "users", uid, "meta", "settings"); }
function processedDoc(uid)    { return doc(db, "users", uid, "meta", "processed"); }

// ── VAULT ─────────────────────────────────────────────────────────────────────
export async function loadVault(uid) {
  const snap = await getDocs(vaultCol(uid));
  return snap.docs.map(d => ({ ...d.data(), firestoreId: d.id }));
}

export function listenVault(uid, onChange) {
  return onSnapshot(vaultCol(uid), snap => {
    onChange(snap.docs.map(d => ({ ...d.data(), firestoreId: d.id })));
  });
}

export async function addVaultEntry(uid, entry) {
  const ref = await addDoc(vaultCol(uid), { ...entry, createdAt: serverTimestamp() });
  return ref.id;
}

export async function updateVaultEntry(uid, firestoreId, data) {
  await updateDoc(doc(vaultCol(uid), firestoreId), data);
}

export async function deleteVaultEntry(uid, firestoreId) {
  await deleteDoc(doc(vaultCol(uid), firestoreId));
}

// ── RECORDS ───────────────────────────────────────────────────────────────────
export async function loadRecords(uid) {
  const snap = await getDocs(recordsCol(uid));
  return snap.docs.map(d => ({ ...d.data(), firestoreId: d.id }));
}

export function listenRecords(uid, onChange) {
  return onSnapshot(recordsCol(uid), snap => {
    const docs = snap.docs.map(d => ({ ...d.data(), firestoreId: d.id }));
    // Sort by receivedOn descending
    docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    onChange(docs);
  });
}

export async function addRecord(uid, record) {
  const { firestoreId, ...clean } = record; // eslint-disable-line no-unused-vars
  const ref = await addDoc(recordsCol(uid), { ...clean, createdAt: serverTimestamp() });
  return ref.id;
}

export async function updateRecord(uid, firestoreId, data) {
  await updateDoc(doc(recordsCol(uid), firestoreId), data);
}

export async function deleteRecord(uid, firestoreId) {
  await deleteDoc(doc(recordsCol(uid), firestoreId));
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
export async function loadSettings(uid) {
  const snap = await getDoc(settingsDoc(uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveSettings(uid, settings) {
  await setDoc(settingsDoc(uid), settings, { merge: true });
}

// ── PROCESSED EMAIL IDs ───────────────────────────────────────────────────────
export async function loadProcessedIds(uid) {
  const snap = await getDoc(processedDoc(uid));
  return snap.exists() ? (snap.data().ids || []) : [];
}

export async function saveProcessedIds(uid, ids) {
  await setDoc(processedDoc(uid), { ids }, { merge: true });
}

// ── PEOPLE (cardholder registry) ──────────────────────────────────────────────
function peopleCol(uid) { return collection(db, "users", uid, "people"); }

export async function loadPeople(uid) {
  const snap = await getDocs(peopleCol(uid));
  return snap.docs.map(d => ({ ...d.data(), firestoreId: d.id }));
}

export function listenPeople(uid, onChange) {
  return onSnapshot(peopleCol(uid), snap => {
    onChange(snap.docs.map(d => ({ ...d.data(), firestoreId: d.id })));
  });
}

export async function addPerson(uid, person) {
  const ref = await addDoc(peopleCol(uid), { ...person, createdAt: serverTimestamp() });
  return ref.id;
}

export async function updatePerson(uid, firestoreId, data) {
  await updateDoc(doc(peopleCol(uid), firestoreId), data);
}

export async function deletePerson(uid, firestoreId) {
  await deleteDoc(doc(peopleCol(uid), firestoreId));
}
