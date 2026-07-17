// --- State & Pure Utilities ---

export const STORAGE_KEY = 'primerKnownWords';
const DB_NAME = 'WordPrimer';
const DB_VERSION = 1;

// --- IndexedDB ---
export function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function dbGet(key) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

export function dbPut(key, value) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const req = tx.objectStore('kv').put(value, key);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

export function dbDelete(key) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const req = tx.objectStore('kv').delete(key);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

// --- State (getters & setters for cross-module use) ---
let _knownWords = new Map();
let _knownSet = new Set();
let _currentAllWords = [];
let _currentFreq = [];
let _originalText = '';
let _sortMode = 'count';
let _hideKanaOnly = localStorage.getItem('primerHideKana') === 'true';
let _tokenizer = null;
let _tokenizerLoading = false;

export function getKnownWords() { return _knownWords; }
export function getKnownSet() { return _knownSet; }
export function getCurrentAllWords() { return _currentAllWords; }
export function getCurrentFreq() { return _currentFreq; }
export function getOriginalText() { return _originalText; }
export function getSortMode() { return _sortMode; }
export function getHideKanaOnly() { return _hideKanaOnly; }

export function setCurrentAllWords(v) { _currentAllWords = v; }
export function setCurrentFreq(v) { _currentFreq = v; }
export function setOriginalText(v) { _originalText = v; }
export function setSortMode(v) { _sortMode = v; }
export function setHideKanaOnly(v) { _hideKanaOnly = v; };

export const CONTENT_POS = new Set([
  '名詞', '動詞', '形容詞', '副詞', '連体詞',
  '感動詞', '接頭詞'
]);

// --- Theme ---
export function getTheme() {
  return localStorage.getItem('primerTheme') || 'light';
}
export function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('primerTheme', theme);
}

// --- Kuromoji XHR patch ---
const _origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
  if (typeof url === 'string' && /^https:\/[a-z]/.test(url) && url.indexOf('kuromoji') !== -1) {
    arguments[1] = url.replace(/^https:\//, 'https://');
  }
  return _origOpen.apply(this, arguments);
};

// --- Known words storage ---
export function loadKnownWords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!arr.length) return;
    _knownWords = new Map();
    _knownSet = new Set();
    if (typeof arr[0] === 'string') {
      const now = new Date().toISOString();
      for (const w of arr) {
        const word = w.trim();
        if (!word || _knownSet.has(word)) continue;
        _knownSet.add(word);
        _knownWords.set(word, now);
      }
      saveKnownWords();
    } else {
      for (const entry of arr) {
        const word = entry.w?.trim();
        if (!word || _knownSet.has(word)) continue;
        _knownSet.add(word);
        _knownWords.set(word, entry.t || new Date().toISOString());
      }
    }
  } catch { _knownWords = new Map(); _knownSet = new Set(); }
}

export function saveKnownWords() {
  const arr = [..._knownWords.entries()]
    .map(([w, t]) => ({ w, t }))
    .sort((a, b) => a.w.localeCompare(b.w));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

export function addKnownWord(word) {
  const cleaned = word.trim();
  if (!cleaned || _knownSet.has(cleaned)) return false;
  _knownSet.add(cleaned);
  _knownWords.set(cleaned, new Date().toISOString());
  saveKnownWords();
  return true;
}

export function removeKnownWord(word) {
  const cleaned = word.trim();
  _knownSet.delete(cleaned);
  _knownWords.delete(cleaned);
  saveKnownWords();
}

export function clearAllKnown() {
  _knownSet.clear();
  _knownWords.clear();
  saveKnownWords();
}

// --- Tokenizer ---
export async function getTokenizer() {
  if (_tokenizer) return _tokenizer;
  if (_tokenizerLoading) {
    while (_tokenizerLoading) await new Promise(r => setTimeout(r, 100));
    if (!_tokenizer) throw new Error('Tokenizer failed to load.');
    return _tokenizer;
  }
  _tokenizerLoading = true;
  return new Promise((resolve, reject) => {
    kuromoji.builder({
      dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/'
    }).build((err, tokenizer) => {
      _tokenizerLoading = false;
      if (err) { reject(err); return; }
      _tokenizer = tokenizer;
      resolve(tokenizer);
    });
  });
}

// --- Utilities ---
export function isKanaOnly(word) {
  return [...word].every(ch => {
    const cp = ch.codePointAt(0);
    return (cp >= 0x3040 && cp <= 0x309F) ||
           (cp >= 0x30A0 && cp <= 0x30FF) ||
           cp === 0x30FC;
  });
}

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function formatDate(date) {
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function highlightWord(text, word) {
  const idx = text.indexOf(word);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) +
    '<span class="sentence-highlight">' + escapeHtml(word) + '</span>' +
    escapeHtml(text.slice(idx + word.length));
}

export function findSentences(word) {
  if (!_originalText) return [];
  const sentences = _originalText.split(/。|！|？|\.|\!|\?|\n/).map(s => s.trim()).filter(Boolean);
  const results = [];
  for (const s of sentences) {
    if (s.includes(word)) { results.push(s); if (results.length >= 5) break; }
  }
  return results;
}
