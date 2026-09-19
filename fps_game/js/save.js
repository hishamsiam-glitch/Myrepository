/* Persistent storage: Android SharedPreferences through the bridge when the
 * game runs in the APK, localStorage in a browser. Values are JSON. */

const KEYS = { save: 'gs.save.v1', settings: 'gs.settings.v1', best: 'gs.best.v1' };

function bridge() {
  const b = typeof window !== 'undefined' ? window.AndroidBridge : null;
  return b && typeof b.getItem === 'function' ? b : null;
}

function readRaw(key) {
  const b = bridge();
  try {
    if (b) return b.getItem(key);
    return localStorage.getItem(key);
  } catch (e) { return null; }
}

function writeRaw(key, value) {
  const b = bridge();
  try {
    if (b) { b.setItem(key, value); return true; }
    localStorage.setItem(key, value);
    return true;
  } catch (e) { return false; }
}

function removeRaw(key) {
  const b = bridge();
  try {
    if (b) { b.removeItem(key); return; }
    localStorage.removeItem(key);
  } catch (e) { /* ignore */ }
}

export const storage = {
  KEYS,
  get(key) {
    const raw = readRaw(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },
  set(key, value) { return writeRaw(key, JSON.stringify(value)); },
  remove(key) { removeRaw(key); },
  backend() { return bridge() ? 'android' : 'localStorage'; },
};
