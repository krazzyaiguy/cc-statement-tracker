import { initializeApp, getApps, getApp } from "firebase/app";
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
} from "firebase/firestore";

// ── Strategy: store ALL user data in ONE document per collection ──────────────
// This means 1 read on login, 1 write per change — instead of per-document
// listeners that burn through free tier quota instantly.
//
// Data structure:
//   /users/{uid}/data/vault    → { entries: [...] }
//   /users/{uid}/data/people   → { entries: [...] }
//   /users/{uid}/data/records  → { entries: [...] }
//   /users/{uid}/data/meta     → { settings, processedIds }

let app, auth, db;

export function initFirebase(config) {
  try {
    const existing = getApps().find(a => a.name === config.projectId);
    app  = existing ? getApp(config.projectId) : initializeApp(config, config.projectId);
    auth = getAuth(app);
    db   = getFirestore(app);
    return true;
  } catch(e) {
    console.error("Firebase init error:", e);
    return false;
  }
}

export function getFirebaseAuth() { return auth; }

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  return { user: result.user, accessToken: credential?.accessToken || null };
}

export async function signOutUser() { await signOut(auth); }
export function onAuthChange(callback) { return onAuthStateChanged(auth, callback); }

// ── Single doc helpers ────────────────────────────────────────────────────────
function dataDoc(uid, key) {
  return doc(db, "users", uid, "data", key);
}

async function loadDoc(uid, key) {
  try {
    const snap = await getDoc(dataDoc(uid, key));
    return snap.exists() ? (snap.data().entries || []) : [];
  } catch(e) {
    console.error(`Firestore load ${key} failed:`, e);
    return [];
  }
}

async function saveDoc(uid, key, entries) {
  try {
    await setDoc(dataDoc(uid, key), { entries, updatedAt: new Date().toISOString() });
    return true;
  } catch(e) {
    console.error(`Firestore save ${key} failed:`, e);
    return false;
  }
}

// ── VAULT ─────────────────────────────────────────────────────────────────────
export async function loadVault(uid)          { return loadDoc(uid, "vault"); }
export async function saveVault(uid, entries) { return saveDoc(uid, "vault", entries); }

// ── PEOPLE ────────────────────────────────────────────────────────────────────
export async function loadPeople(uid)          { return loadDoc(uid, "people"); }
export async function savePeople(uid, entries) { return saveDoc(uid, "people", entries); }

// ── RECORDS ───────────────────────────────────────────────────────────────────
export async function loadRecords(uid)          { return loadDoc(uid, "records"); }
export async function saveRecords(uid, entries) { return saveDoc(uid, "records", entries); }

// ── ITR DATA ──────────────────────────────────────────────────────────────────
export async function loadITR(uid) {
  try {
    const snap = await getDoc(dataDoc(uid, "itr"));
    return snap.exists() ? (snap.data().itrData || {}) : {};
  } catch(e) {
    console.error("Firestore load itr failed:", e);
    return {};
  }
}

export async function saveITR(uid, itrData) {
  try {
    await setDoc(dataDoc(uid, "itr"), { itrData, updatedAt: new Date().toISOString() });
    return true;
  } catch(e) {
    console.error("Firestore save itr failed:", e);
    return false;
  }
}

// ── BANK RULES ────────────────────────────────────────────────────────────────
export async function loadBankRules(uid) {
  try {
    const snap = await getDoc(dataDoc(uid, "bankRules"));
    return snap.exists() ? (snap.data().entries || null) : null;
  } catch(e) {
    console.error("Firestore load bankRules failed:", e);
    return null;
  }
}

export async function saveBankRules(uid, entries) {
  try {
    await setDoc(dataDoc(uid, "bankRules"), { entries, updatedAt: new Date().toISOString() });
    return true;
  } catch(e) {
    console.error("Firestore save bankRules failed:", e);
    return false;
  }
}
export async function loadMeta(uid) {
  try {
    const snap = await getDoc(dataDoc(uid, "meta"));
    return snap.exists() ? snap.data() : {};
  } catch(e) { return {}; }
}

export async function saveMeta(uid, data) {
  try {
    await setDoc(dataDoc(uid, "meta"), { ...data, updatedAt: new Date().toISOString() });
    return true;
  } catch(e) { return false; }
}

// ── SHARED BANK RULES (global — same for all users) ───────────────────────────
// Stored at /shared/bankRules — readable/writable by any signed-in user
export async function loadSharedBankRules() {
  try {
    const snap = await getDoc(doc(db, "shared", "bankRules"));
    return snap.exists() ? (snap.data().entries || null) : null;
  } catch(e) {
    console.error("Firestore load sharedBankRules failed:", e);
    return null;
  }
}

export async function saveSharedBankRules(entries) {
  try {
    await setDoc(doc(db, "shared", "bankRules"), {
      entries,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch(e) {
    console.error("Firestore save sharedBankRules failed:", e);
    return false;
  }
}
