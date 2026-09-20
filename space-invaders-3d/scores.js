// Arcade-style high-score table + per-game score log, persisted in
// localStorage. Everything is defensive: private browsing or blocked storage
// just means nothing persists.

const KEY_HI = 'si3d.v1.hiscores';
const KEY_LOG = 'si3d.v1.scorelog';
const KEY_SETTINGS = 'si3d.v1.settings';
const KEY_BEST_LEVEL = 'si3d.v1.bestlevel';

export const HI_TABLE_SIZE = 10;
export const LOG_SIZE = 50;

const DEFAULT_HISCORES = [
  { name: 'ACE', score: 50000, level: 25, date: 0 },
  { name: 'ZAP', score: 30000, level: 18, date: 0 },
  { name: 'NEO', score: 20000, level: 14, date: 0 },
  { name: 'LEX', score: 12000, level: 10, date: 0 },
  { name: 'JIM', score: 8000,  level: 8,  date: 0 },
  { name: 'SUE', score: 5000,  level: 6,  date: 0 },
  { name: 'BOB', score: 3000,  level: 4,  date: 0 },
  { name: 'KAI', score: 2000,  level: 3,  date: 0 },
  { name: 'MIA', score: 1000,  level: 2,  date: 0 },
  { name: 'ROB', score: 500,   level: 1,  date: 0 },
];

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage unavailable: ignore */
  }
}

export function getHighScores() {
  const list = read(KEY_HI, null);
  if (!Array.isArray(list) || list.length === 0) return DEFAULT_HISCORES.slice();
  return list
    .filter((e) => e && typeof e.score === 'number')
    .sort((a, b) => b.score - a.score || b.level - a.level)
    .slice(0, HI_TABLE_SIZE);
}

export function getTopScore() {
  const hs = getHighScores();
  return hs.length ? hs[0].score : 0;
}

// Returns the 1-based rank this score would take, or 0 if it does not qualify.
export function qualifyingRank(score) {
  if (score <= 0) return 0;
  const hs = getHighScores();
  let rank = hs.findIndex((e) => score > e.score);
  if (rank === -1) rank = hs.length;
  return rank < HI_TABLE_SIZE ? rank + 1 : 0;
}

export function addHighScore(entry) {
  const hs = getHighScores();
  hs.push({
    name: String(entry.name || 'AAA').toUpperCase().slice(0, 3).padEnd(3, 'A'),
    score: Math.max(0, Math.floor(entry.score || 0)),
    level: Math.max(1, Math.floor(entry.level || 1)),
    date: entry.date || Date.now(),
  });
  hs.sort((a, b) => b.score - a.score || b.level - a.level);
  const trimmed = hs.slice(0, HI_TABLE_SIZE);
  write(KEY_HI, trimmed);
  return trimmed;
}

export function getScoreLog() {
  const log = read(KEY_LOG, []);
  return Array.isArray(log) ? log : [];
}

// A score-log line is written for every game played, whether or not it
// makes the high-score table. Newest first.
export function logGame(entry) {
  const log = getScoreLog();
  log.unshift({
    score: Math.floor(entry.score || 0),
    level: Math.floor(entry.level || 1),
    kills: Math.floor(entry.kills || 0),
    seconds: Math.floor(entry.seconds || 0),
    result: entry.result || 'GAME OVER',
    control: entry.control || 'KEYS',
    date: entry.date || Date.now(),
  });
  write(KEY_LOG, log.slice(0, LOG_SIZE));
  const best = getBestLevel();
  if ((entry.level || 1) > best) write(KEY_BEST_LEVEL, Math.floor(entry.level));
}

export function getBestLevel() {
  const v = read(KEY_BEST_LEVEL, 1);
  return typeof v === 'number' && v >= 1 ? v : 1;
}

export function setBestLevel(level) {
  if (level > getBestLevel()) write(KEY_BEST_LEVEL, Math.floor(level));
}

export function clearAllScores() {
  try {
    localStorage.removeItem(KEY_HI);
    localStorage.removeItem(KEY_LOG);
    localStorage.removeItem(KEY_BEST_LEVEL);
  } catch (e) { /* ignore */ }
}

export const DEFAULT_SETTINGS = {
  sound: true,
  autofire: true,
  invert: false,
  sensitivity: 3,     // 1 (gentle) .. 5 (twitchy)
  forwardBack: true,  // tilt forward/back moves the ship in depth
};

export function getSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, read(KEY_SETTINGS, {}));
}

export function saveSettings(s) {
  write(KEY_SETTINGS, Object.assign({}, DEFAULT_SETTINGS, s));
}

export function formatScore(n) {
  return String(Math.max(0, Math.floor(n))).padStart(6, '0');
}

export function formatDate(ts) {
  if (!ts) return '  --  ';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
