const STORAGE_KEY = 'primerKnownWords';
const DB_NAME = 'WordPrimer';
const DB_VERSION = 1;

// --- IndexedDB helpers ---

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(key) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

function dbPut(key, value) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const req = tx.objectStore('kv').put(value, key);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

function dbDelete(key) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const req = tx.objectStore('kv').delete(key);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

// --- State ---
let knownWords = new Map();     // word -> ISO timestamp
let knownSet = new Set();       // fast membership lookup
let currentAllWords = [];       // all unique words from last paste (for re-priming)
let currentFreq = [];           // {word, count}[] from the current paste, sorted by count desc
let originalText = '';          // raw text from the last paste (for sentence context)
let sortMode = 'count';         // 'count' | 'rank'
let hideKanaOnly = localStorage.getItem('primerHideKana') === 'true';

// Dictionary state
let dictMap = null;             // Map<word, rank> or null
let dictName = '';              // display name of loaded dict

// --- DOM refs (Primer) ---
const pasteTextarea = document.getElementById('pasteTextarea');
const extractBtn = document.getElementById('extractBtn');
const downloadBtn = document.getElementById('downloadBtn');
const pasteStatus = document.getElementById('pasteStatus');
const sortSelect = document.getElementById('sortSelect');
const hideKanaCheckbox = document.getElementById('hideKanaCheckbox');
const knownCount = document.getElementById('knownCount');
const wordSection = document.getElementById('wordSection');
const wordList = document.getElementById('wordList');
const emptyState = document.getElementById('emptyState');
const openLibraryBtn = document.getElementById('openLibraryBtn');

// --- DOM refs (Library) ---
const primerView = document.getElementById('primerView');
const libraryView = document.getElementById('libraryView');
const libraryKnownCount = document.getElementById('libraryKnownCount');
const libraryList = document.getElementById('libraryList');
const libraryEmpty = document.getElementById('libraryEmpty');
const backToPrimerBtn = document.getElementById('backToPrimerBtn');
const libraryImportBtn = document.getElementById('libraryImportBtn');
const libraryExportBtn = document.getElementById('libraryExportBtn');
const libraryFileInput = document.getElementById('libraryFileInput');
const dictBar = document.getElementById('dictBar');
const dictBtn = document.getElementById('dictBtn');
const dictFileInput = document.getElementById('dictFileInput');

// --- DOM refs (Modals) ---
const contextModal = document.getElementById('contextModal');
const contextWordTitle = document.getElementById('contextWordTitle');
const contextSentences = document.getElementById('contextSentences');
const downloadModal = document.getElementById('downloadModal');

// --- Theme ---

function getTheme() {
  return localStorage.getItem('primerTheme') || 'light';
}

function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('primerTheme', theme);
  themeBtn.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

const themeBtn = document.getElementById('themeBtn');
setTheme(getTheme());

themeBtn.addEventListener('click', () => {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
});

// --- Init ---
loadKnownWords();
hideKanaCheckbox.checked = hideKanaOnly;
renderStats();
updatePrimerUI();

var d = new Date(document.lastModified);
var y = d.getFullYear();
var m = String(d.getMonth() + 1).padStart(2, '0');
var day = String(d.getDate()).padStart(2, '0');
var h = String(d.getHours()).padStart(2, '0');
var min = String(d.getMinutes()).padStart(2, '0');
document.getElementById('version').textContent = 'v' + y + m + day + h + min;

loadDictFromDB().then(() => {
  renderStats();
  renderDictUI();
  reprime();
});

// --- Storage ---

function loadKnownWords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (arr.length === 0) return;

    knownWords = new Map();
    knownSet = new Set();

    if (typeof arr[0] === 'string') {
      const now = new Date().toISOString();
      for (const w of arr) {
        const word = w.trim();
        if (!word || knownSet.has(word)) continue;
        knownSet.add(word);
        knownWords.set(word, now);
      }
      saveKnownWords();
    } else {
      for (const entry of arr) {
        const word = entry.w?.trim();
        if (!word || knownSet.has(word)) continue;
        knownSet.add(word);
        knownWords.set(word, entry.t || new Date().toISOString());
      }
    }
  } catch {
    knownWords = new Map();
    knownSet = new Set();
  }
}

function saveKnownWords() {
  const arr = [...knownWords.entries()]
    .map(([w, t]) => ({ w, t }))
    .sort((a, b) => a.w.localeCompare(b.w));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

function addKnownWord(word) {
  const cleaned = word.trim();
  if (!cleaned || knownSet.has(cleaned)) return false;
  knownSet.add(cleaned);
  knownWords.set(cleaned, new Date().toISOString());
  saveKnownWords();
  renderStats();
  return true;
}

function removeKnownWord(word) {
  const cleaned = word.trim();
  knownSet.delete(cleaned);
  knownWords.delete(cleaned);
  saveKnownWords();
  renderStats();
}

function clearAllKnown() {
  if (knownSet.size === 0) return;
  if (!confirm(`Clear all ${knownSet.size} known words?`)) return;
  knownSet.clear();
  knownWords.clear();
  saveKnownWords();
  renderStats();
  reprime();
  renderLibrary();
}

function reprime() {
  if (currentAllWords.length > 0) {
    applyFilters();
  } else {
    updatePrimerUI();
  }
}

// --- Import/Export ---

function importKnownWords(text) {
  text = text.replace(/^﻿/, '');
  const words = text.split(/\r?\n/)
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.normalize('NFC'));

  if (words.length === 0) {
    alert('No words found in file.');
    return;
  }

  const now = new Date().toISOString();
  let added = 0;
  for (const w of words) {
    if (!knownSet.has(w)) {
      knownSet.add(w);
      knownWords.set(w, now);
      added++;
    }
  }
  if (added > 0) {
    saveKnownWords();
    renderStats();
  }

  reprime();
  renderLibrary();
}

function exportKnownWords() {
  if (knownSet.size === 0) {
    alert('No known words to export.');
    return;
  }
  downloadTextFile([...knownSet].sort().join('\n'), 'known-words.txt');
}

function downloadTextFile(text, filename) {
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

// --- Dictionary ---

function extractRank(entry) {
  const data = entry[2];
  if (!data) return null;
  if (data.frequency) return data.frequency.value;
  return data.value || null;
}

async function loadDictionary(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const metaFile = zip.file('term_meta_bank_1.json');
    if (!metaFile) {
      alert('Dictionary zip must contain term_meta_bank_1.json');
      return;
    }

    const text = await metaFile.async('string');
    dictBar.textContent = 'Parsing dictionary...';

    const entries = JSON.parse(text);
    const map = new Map();

    for (const entry of entries) {
      const word = entry[0]?.trim();
      if (!word) continue;
      const rank = extractRank(entry);
      if (rank != null && rank > 0) {
        const existing = map.get(word);
        if (existing == null || rank < existing) {
          map.set(word, rank);
        }
      }
    }

    dictMap = map;

    const indexFile = zip.file('index.json');
    if (indexFile) {
      try {
        const index = JSON.parse(await indexFile.async('string'));
        dictName = index.title || 'Dictionary';
      } catch {
        dictName = 'Dictionary';
      }
    } else {
      dictName = 'Dictionary';
    }

    renderStats();
    renderDictUI();
    reprime();

    dictBar.textContent = 'Saving to local database...';
    await Promise.all([
      dbPut('dictName', dictName),
      dbPut('dictData', [...dictMap.entries()])
    ]);
    dictBar.textContent = `${dictName} (${dictMap.size.toLocaleString()} entries)`;

    alert(`Loaded ${dictMap.size.toLocaleString()} entries from "${dictName}".`);
  } catch (err) {
    console.error(err);
    alert('Failed to load dictionary. Make sure the file is a valid ZIP with term_meta_bank_1.json.');
  }
}

async function loadDictFromDB() {
  try {
    const [name, data] = await Promise.all([dbGet('dictName'), dbGet('dictData')]);
    if (name && data && Array.isArray(data)) {
      dictName = name;
      dictMap = new Map(data);
    }
  } catch (err) {
    console.warn('Failed to load dict from DB:', err);
  }
}

function unloadDictionary() {
  dictMap = null;
  dictName = '';
  dbDelete('dictName').catch(() => {});
  dbDelete('dictData').catch(() => {});
  renderStats();
  renderDictUI();
  reprime();
}

function renderDictUI() {
  if (dictMap) {
    dictBar.textContent = `${dictName} (${dictMap.size.toLocaleString()} entries)`;
    dictBar.classList.remove('hidden');
    dictBtn.textContent = 'Remove Dict';
  } else {
    dictBar.classList.add('hidden');
    dictBtn.textContent = 'Load Dict...';
  }
}

// --- Paste & Extract ---

let _tokenizer = null;
let _tokenizerLoading = false;

// Kuromoji's bundled path.join strips https:// to https:/ (POSIX normalize
// treats // as empty segments). Intercept XMLHttpRequest to fix the URL.
var _origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
  if (typeof url === 'string' && /^https:\/[a-z]/.test(url) && url.indexOf('kuromoji') !== -1) {
    arguments[1] = url.replace(/^https:\//, 'https://');
  }
  return _origOpen.apply(this, arguments);
};

async function getTokenizer() {
  if (_tokenizer) return _tokenizer;
  if (_tokenizerLoading) {
    while (_tokenizerLoading) await new Promise(r => setTimeout(r, 100));
    if (!_tokenizer) throw new Error('Tokenizer failed to load.');
    return _tokenizer;
  }
  _tokenizerLoading = true;
  pasteStatus.textContent = 'Downloading Japanese dictionary...';

  return new Promise((resolve, reject) => {
    kuromoji.builder({
      dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/'
    }).build((err, tokenizer) => {
      _tokenizerLoading = false;
      if (err) {
        pasteStatus.textContent = '';
        reject(err);
        return;
      }
      _tokenizer = tokenizer;
      pasteStatus.textContent = '';
      resolve(tokenizer);
    });
  });
}

const CONTENT_POS = new Set([
  '名詞', '動詞', '形容詞', '副詞', '連体詞',
  '感動詞', '接頭詞'
]);

async function extractFromPaste(text) {
  text = text.replace(/^﻿/, '').trim();
  if (!text) {
    pasteStatus.textContent = 'No text to process.';
    return;
  }

  originalText = text;
  pasteStatus.textContent = 'Tokenizing...';

  try {
    const tokenizer = await getTokenizer();

    // Chunk the text so the UI doesn't freeze — split by newlines so
    // each chunk is a small batch of lines (~1 paragraph/screen of dialog)
    const lines = text.split('\n');
    const CHUNK_SIZE = 20;
    const wordMap = new Map();
    let totalTokens = 0;

    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      const chunk = lines.slice(i, i + CHUNK_SIZE).join('\n');
      const tokens = tokenizer.tokenize(chunk);
      totalTokens += tokens.length;

      for (const token of tokens) {
        const pos = token.pos;
        if (!CONTENT_POS.has(pos)) continue;

        let word;
        if (pos === '動詞' || pos === '形容詞') {
          word = (token.basic_form || token.surface_form).trim();
        } else {
          word = token.surface_form.trim();
        }

        if (!word || /^[^　-鿿豈-﫿a-zA-Z]+$/.test(word)) continue;

        wordMap.set(word, (wordMap.get(word) || 0) + 1);
      }

      // Yield to the event loop so the UI stays responsive
      await new Promise(r => setTimeout(r, 0));
    }

    const entries = [...wordMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([word, count]) => ({ word, count }));

    if (entries.length === 0) {
      pasteStatus.textContent = 'No words could be extracted.';
      return;
    }

    currentAllWords = entries.map(e => e.word);
    currentFreq = entries;
    applyFilters();
    pasteStatus.textContent = `Extracted ${entries.length} unique words (${totalTokens} tokens).`;
    downloadBtn.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    pasteStatus.textContent = err.message || 'Failed to tokenize text.';
  }
}

// --- Filtering & Sorting ---

function isKanaOnly(word) {
  return [...word].every(ch => {
    const cp = ch.codePointAt(0);
    return (cp >= 0x3040 && cp <= 0x309F) ||  // Hiragana
           (cp >= 0x30A0 && cp <= 0x30FF) ||  // Katakana
           cp === 0x30FC;                      // prolonged sound mark ー
  });
}

function applyFilters() {
  let entries = currentFreq.slice();

  // Filter out known
  entries = entries.filter(e => !knownSet.has(e.word));

  // Filter kana-only
  if (hideKanaOnly) {
    entries = entries.filter(e => !isKanaOnly(e.word));
  }

  // Sort
  if (sortMode === 'rank' && dictMap) {
    entries.sort((a, b) => {
      const ra = dictMap.get(a.word);
      const rb = dictMap.get(b.word);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return b.count - a.count;
    });
  } else {
    entries.sort((a, b) => b.count - a.count);
  }

  renderWordList(entries);
  updatePrimerUI();
}

// --- Sentence Context ---

function findSentences(word) {
  if (!originalText) return [];
  const sentences = originalText.split(/。|！|？|\.|\!|\?|\n/).map(s => s.trim()).filter(Boolean);
  const results = [];
  for (const s of sentences) {
    if (s.includes(word)) {
      results.push(s);
      if (results.length >= 5) break;
    }
  }
  return results;
}

// --- Modals ---

function openContextModal(word) {
  const sentences = findSentences(word);
  contextWordTitle.textContent = word;
  contextSentences.innerHTML = '';

  if (sentences.length === 0) {
    contextSentences.innerHTML = '<p class="no-context-msg">No sentences found containing this word.</p>';
  } else {
    for (let i = 0; i < sentences.length; i++) {
      const div = document.createElement('div');
      div.className = 'sentence-item';
      div.innerHTML = `<span class="sentence-marker">${i + 1}.</span> ${highlightWord(sentences[i], word)}`;
      contextSentences.appendChild(div);
    }
  }

  contextModal.classList.remove('hidden');
}

function closeContextModal() {
  contextModal.classList.add('hidden');
}

function openDownloadModal() {
  downloadModal.classList.remove('hidden');
}

function closeDownloadModal() {
  downloadModal.classList.add('hidden');
}

function highlightWord(text, word) {
  const idx = text.indexOf(word);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) +
    '<span class="sentence-highlight">' + escapeHtml(word) + '</span>' +
    escapeHtml(text.slice(idx + word.length));
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Download ---

function getVisibleEntries() {
  // Use whatever is currently rendered (filtered + sorted)
  return currentFreq
    .filter(e => !knownSet.has(e.word))
    .filter(e => hideKanaOnly ? !isKanaOnly(e.word) : true);
}

function downloadWeighted() {
  const entries = getVisibleEntries();
  const lines = [];
  for (const { word, count } of entries) {
    for (let i = 0; i < count; i++) lines.push(word);
  }
  downloadTextFile(lines.join('\n'), 'weighted-words.txt');
  closeDownloadModal();
}

function downloadUnique() {
  const entries = getVisibleEntries();
  const lines = [];
  for (const { word, count } of entries) {
    for (let i = 0; i < count; i++) lines.push(word);
  }
  // Deduplicate but keep frequency order
  const seen = new Set();
  const deduped = [];
  for (const w of lines) {
    if (!seen.has(w)) { seen.add(w); deduped.push(w); }
  }
  downloadTextFile(deduped.join('\n'), 'unique-words.txt');
  closeDownloadModal();
}

function downloadCSV() {
  const entries = getVisibleEntries();
  const BOM = '﻿';
  const rows = ['word,count,sentences'];
  for (const { word, count } of entries) {
    const sentences = findSentences(word);
    const sentenceStr = sentences.join(' | ');
    // Escape " as "" for CSV
    const escaped = `"${word}","${count}","${sentenceStr.replace(/"/g, '""')}"`;
    rows.push(escaped);
  }
  downloadTextFile(BOM + rows.join('\n'), 'words-with-sentences.csv');
  closeDownloadModal();
}

// --- Rendering (Primer) ---

function getDictRank(word) {
  if (!dictMap) return null;
  return dictMap.get(word) ?? null;
}

function renderWordList(entries) {
  wordList.innerHTML = '';

  if (entries.length === 0) {
    wordSection.classList.add('hidden');
    return;
  }

  wordSection.classList.remove('hidden');
  emptyState.classList.add('hidden');

  for (const { word, count } of entries) {
    const item = document.createElement('div');
    item.className = 'word-item';
    if (knownSet.has(word)) item.classList.add('word-item--added');

    // Word label with freq badge
    const label = document.createElement('span');
    label.className = 'word-label';

    const textSpan = document.createElement('span');
    textSpan.className = 'word-text';
    textSpan.textContent = word;
    textSpan.title = 'Click to see context';
    textSpan.addEventListener('click', () => openContextModal(word));

    label.appendChild(textSpan);

    if (count > 0) {
      const freqBadge = document.createElement('span');
      freqBadge.className = 'word-freq';
      freqBadge.textContent = `×${count}`;
      label.appendChild(freqBadge);
    }

    // Right side: rank + actions
    const right = document.createElement('div');
    right.className = 'word-right';

    const rankVal = dictMap ? getDictRank(word) : null;
    if (rankVal != null) {
      const rankSpan = document.createElement('span');
      rankSpan.className = 'word-rank';
      rankSpan.textContent = `#${rankVal}`;
      right.appendChild(rankSpan);
    }

    const actions = document.createElement('div');
    actions.className = 'word-actions';

    const addBtn = document.createElement('button');
    if (knownSet.has(word)) {
      addBtn.className = 'btn btn-undo-text';
      addBtn.textContent = 'Undo';
    } else {
      addBtn.className = 'btn btn-add';
      addBtn.textContent = 'Add to Known';
    }

    addBtn.addEventListener('click', () => {
      if (knownSet.has(word)) {
        removeKnownWord(word);
        item.classList.remove('word-item--added');
        addBtn.className = 'btn btn-add';
        addBtn.textContent = 'Add to Known';
      } else {
        addKnownWord(word);
        item.classList.add('word-item--added');
        addBtn.className = 'btn btn-undo-text';
        addBtn.textContent = 'Undo';
      }
    });

    actions.appendChild(addBtn);
    right.appendChild(actions);
    item.appendChild(label);
    item.appendChild(right);
    wordList.appendChild(item);
  }

}

function renderStats() {
  knownCount.textContent = knownSet.size;
  libraryKnownCount.textContent = knownSet.size;
}

function updatePrimerUI() {
  const hasWords = wordList.children.length > 0;
  wordSection.classList.toggle('hidden', !hasWords);
  emptyState.classList.toggle('hidden', hasWords);

  const emptyMsg = emptyState.querySelector('p');
  if (!hasWords && currentAllWords.length > 0) {
    emptyMsg.textContent = 'All words are already in your known list or excluded by the current filter.';
  } else {
    emptyMsg.textContent = 'No new words to show. Paste some text above to get started.';
  }
}

// --- View Switching ---

function showPrimerView() {
  primerView.classList.remove('hidden');
  libraryView.classList.add('hidden');
}

function showLibraryView() {
  renderLibrary();
  renderDictUI();
  libraryView.classList.remove('hidden');
  primerView.classList.add('hidden');
}

openLibraryBtn.addEventListener('click', showLibraryView);
backToPrimerBtn.addEventListener('click', showPrimerView);

// --- Library ---

function renderLibrary() {
  const entries = [...knownWords.entries()]
    .map(([word, ts]) => ({ word, ts: new Date(ts) }))
    .sort((a, b) => b.ts - a.ts);

  libraryList.innerHTML = '';

  if (entries.length === 0) {
    libraryList.classList.add('hidden');
    libraryEmpty.classList.remove('hidden');
    return;
  }

  libraryList.classList.remove('hidden');
  libraryEmpty.classList.add('hidden');

  for (const { word, ts } of entries) {
    const item = document.createElement('div');
    item.className = 'word-item';

    const textSpan = document.createElement('span');
    textSpan.className = 'word-text';
    textSpan.textContent = word;

    const dateSpan = document.createElement('span');
    dateSpan.className = 'word-date';
    dateSpan.textContent = formatDate(ts);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-text btn-text-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      removeKnownWord(word);
      renderLibrary();
      reprime();
    });

    const actions = document.createElement('div');
    actions.className = 'word-actions';
    actions.appendChild(dateSpan);
    actions.appendChild(removeBtn);

    item.appendChild(textSpan);
    item.appendChild(actions);
    libraryList.appendChild(item);
  }
}

function formatDate(date) {
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// --- Event Handlers (Primer Controls) ---

extractBtn.addEventListener('click', () => {
  extractFromPaste(pasteTextarea.value);
});

sortSelect.addEventListener('change', () => {
  sortMode = sortSelect.value;
  if (currentAllWords.length > 0) applyFilters();
});

hideKanaCheckbox.addEventListener('change', () => {
  hideKanaOnly = hideKanaCheckbox.checked;
  localStorage.setItem('primerHideKana', hideKanaOnly);
  if (currentAllWords.length > 0) applyFilters();
});

downloadBtn.addEventListener('click', openDownloadModal);

// --- Modal Event Handlers ---

// Close context modal
contextModal.querySelector('.modal-backdrop').addEventListener('click', closeContextModal);
contextModal.querySelector('.modal-close').addEventListener('click', closeContextModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!contextModal.classList.contains('hidden')) closeContextModal();
    if (!downloadModal.classList.contains('hidden')) closeDownloadModal();
  }
});

// Close download modal
downloadModal.querySelector('.modal-backdrop').addEventListener('click', closeDownloadModal);
downloadModal.querySelector('.modal-close').addEventListener('click', closeDownloadModal);

// Download buttons
downloadModal.querySelectorAll('.download-option').forEach(opt => {
  const btn = opt.querySelector('.download-btn');
  btn.addEventListener('click', () => {
    const format = opt.dataset.format;
    if (format === 'weighted') downloadWeighted();
    else if (format === 'unique') downloadUnique();
    else if (format === 'csv') downloadCSV();
  });
});

// --- Event Handlers (Library) ---

libraryImportBtn.addEventListener('click', () => libraryFileInput.click());

libraryFileInput.addEventListener('change', () => {
  if (libraryFileInput.files.length > 0) {
    const reader = new FileReader();
    reader.onload = (e) => importKnownWords(e.target.result);
    reader.readAsText(libraryFileInput.files[0], 'UTF-8');
    libraryFileInput.value = '';
  }
});

libraryExportBtn.addEventListener('click', exportKnownWords);

// --- Event Handlers (Dictionary) ---

dictBtn.addEventListener('click', () => {
  if (dictMap) {
    unloadDictionary();
  } else {
    dictFileInput.click();
  }
});

dictFileInput.addEventListener('change', () => {
  if (dictFileInput.files.length > 0) {
    loadDictionary(dictFileInput.files[0]);
    dictFileInput.value = '';
  }
});
