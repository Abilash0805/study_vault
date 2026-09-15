// ═══════════════════════════════════════════════════════════
//  Firebase bootstrap — single init shared by every page.
//  Firestore helpers are re-exported so pages import from here
//  only, keeping the SDK version pinned in one place.
// ═══════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where, orderBy, limit,
  arrayRemove, arrayUnion, serverTimestamp, writeBatch, runTransaction, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { FIREBASE_CONFIG } from './config.js';

export const app  = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db   = getFirestore(app);

export {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where, orderBy, limit,
  arrayRemove, arrayUnion, serverTimestamp, writeBatch, runTransaction, deleteField
};
