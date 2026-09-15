// Thin wrapper around Firestore that mirrors the get/set shape this app was
// originally built against, so the rest of the code barely had to change.
// Every key is a document in the "poolLeague" collection.
import { db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export async function storageGet(key) {
  try {
    const ref = doc(db, "poolLeague", key);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return { key, value: data.value, version: data.updatedAt || "1" };
  } catch (e) {
    console.error("storageGet failed", key, e);
    return null;
  }
}

export async function storageSet(key, value) {
  try {
    const ref = doc(db, "poolLeague", key);
    const updatedAt = new Date().toISOString();
    await setDoc(ref, { value, updatedAt });
    return { key, value, version: updatedAt };
  } catch (e) {
    console.error("storageSet failed", key, e);
    return null;
  }
}
