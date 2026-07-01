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
let currentAllWords = [];       // all unique words from last file drop (for re-priming)
let currentFreq = [];           // {word, count}[] for the current file, sorted by count desc

// Dictionary state
let dictMap = null;             // Map<word, rank> or null
let dictName = '';              // display name of loaded dict

// --- DOM refs (Primer) ---
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const knownCount = document.getElementById('knownCount');
const newStat = document.getElementById('newStat');
const newCount = document.getElementById('newCount');
const dictPrimerStat = document.getElementById('dictPrimerStat');
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
const libraryClearBtn = document.getElementById('libraryClearBtn');
const libraryFileInput = document.getElementById('libraryFileInput');
const dictBar = document.getElementById('dictBar');
const dictBtn = document.getElementById('dictBtn');
const dictFileInput = document.getElementById('dictFileInput');

// --- Init ---
loadKnownWords();
renderStats();
updatePrimerUI();
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
    filterAndRender();
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
  // Format 1: ["word", "freq", {value: N, displayValue: "N"}]
  // Format 2: ["word", "freq", {reading: "…", frequency: {value: N, displayValue: "N"}}]
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

    // Parse in chunks to avoid UI freeze on 24MB JSON
    const entries = JSON.parse(text);
    const map = new Map();

    for (const entry of entries) {
      const word = entry[0]?.trim();
      if (!word) continue;
      const rank = extractRank(entry);
      if (rank != null && rank > 0) {
        // Keep the best (lowest) rank for words with multiple readings
        const existing = map.get(word);
        if (existing == null || rank < existing) {
          map.set(word, rank);
        }
      }
    }

    dictMap = map;

    // Extract dict name from index.json
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

    // Persist to IndexedDB
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

// --- New Words Processing ---

function processNewWordsFile(text) {
  text = text.replace(/^﻿/, '');
  const words = text.split(/\r?\n/)
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.normalize('NFC'));

  if (words.length === 0) {
    alert('File is empty or contains no valid words.');
    return;
  }

  const freq = new Map();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  currentAllWords = [...freq.keys()];

  const entries = [...freq.entries()]
    .filter(([word]) => !knownSet.has(word))
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => ({ word, count }));

  currentFreq = entries;
  renderWordList(entries);
  updatePrimerUI();
}

function filterAndRender() {
  const freqMap = new Map(currentFreq.map(e => [e.word, e.count]));
  const entries = currentAllWords
    .filter(w => !knownSet.has(w))
    .map(word => ({ word, count: freqMap.get(word) || 1 }))
    .sort((a, b) => b.count - a.count);

  currentFreq = entries;
  renderWordList(entries);
  updatePrimerUI();
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
    item.dataset.word = word;

    const textSpan = document.createElement('span');
    textSpan.className = 'word-text';
    textSpan.textContent = word;

    // ~ freq badge next to word
    const label = document.createElement('span');
    label.className = 'word-label';
    label.appendChild(textSpan);

    if (count > 0) {
      const freqBadge = document.createElement('span');
      freqBadge.className = 'word-freq';
      freqBadge.textContent = `×${count}`;
      label.appendChild(freqBadge);
    }

    // ~ rank badge on the right
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
    addBtn.className = 'btn btn-add';
    addBtn.textContent = 'Add to Known';

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
      updateNewCount();
    });

    actions.appendChild(addBtn);
    right.appendChild(actions);
    item.appendChild(label);
    item.appendChild(right);
    wordList.appendChild(item);
  }

  updateNewCount();
}

function updateNewCount() {
  const remaining = wordList.querySelectorAll('.word-item:not(.word-item--added)').length;
  newCount.textContent = remaining;
  newStat.classList.toggle('hidden', wordList.children.length === 0);
}

function renderStats() {
  knownCount.textContent = knownSet.size;
  libraryKnownCount.textContent = knownSet.size;
  if (dictMap) {
    dictPrimerStat.textContent = `Dict: ${dictName}`;
    dictPrimerStat.classList.remove('hidden');
  } else {
    dictPrimerStat.classList.add('hidden');
  }
}

function updatePrimerUI() {
  const hasWords = wordList.children.length > 0;
  wordSection.classList.toggle('hidden', !hasWords);
  emptyState.classList.toggle('hidden', hasWords);

  const emptyMsg = emptyState.querySelector('p');
  if (!hasWords && currentAllWords.length > 0) {
    emptyMsg.textContent = 'All words from the file are already in your known list.';
  } else {
    emptyMsg.textContent = 'No new words to show. Drop a file above to get started.';
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

// --- Event Handlers (Drop Zone) ---

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    handleFile(fileInput.files[0]);
    fileInput.value = '';
  }
});

function handleFile(file) {
  if (!file.name.endsWith('.txt')) {
    alert('Please drop a .txt file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    processNewWordsFile(e.target.result);
  };
  reader.onerror = () => {
    alert('Error reading file.');
  };
  reader.readAsText(file, 'UTF-8');
}

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

libraryClearBtn.addEventListener('click', () => {
  clearAllKnown();
  renderLibrary();
});

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
