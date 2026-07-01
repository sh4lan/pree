const STORAGE_KEY = 'primerKnownWords';

// --- State ---
let knownWords = new Map();     // word -> ISO timestamp
let knownSet = new Set();       // fast membership lookup
let currentAllWords = [];       // all unique words from last file drop (for re-priming)
let currentFreq = [];           // {word, count}[] for the current file, sorted by count desc

// --- DOM refs ---
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const knownCount = document.getElementById('knownCount');
const newStat = document.getElementById('newStat');
const newCount = document.getElementById('newCount');
const wordSection = document.getElementById('wordSection');
const wordList = document.getElementById('wordList');
const emptyState = document.getElementById('emptyState');

// Library overlay
const openLibraryBtn = document.getElementById('openLibraryBtn');
const closeLibraryBtn = document.getElementById('closeLibraryBtn');
const libraryOverlay = document.getElementById('libraryOverlay');
const libraryList = document.getElementById('libraryList');
const libraryEmpty = document.getElementById('libraryEmpty');
const libraryImportBtn = document.getElementById('libraryImportBtn');
const libraryExportBtn = document.getElementById('libraryExportBtn');
const libraryClearBtn = document.getElementById('libraryClearBtn');
const libraryFileInput = document.getElementById('libraryFileInput');

// --- Init ---
loadKnownWords();
renderStats();
updatePrimerUI();

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

  // Build frequency map
  const freq = new Map();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // Store unique words for re-priming
  currentAllWords = [...freq.keys()];

  // Sort by frequency desc, keeping only unknown words
  const entries = [...freq.entries()]
    .filter(([word]) => !knownSet.has(word))
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => ({ word, count }));

  currentFreq = entries;
  renderWordList(entries);
  updatePrimerUI();
}

function filterAndRender() {
  // Re-filter currentAllWords through current known set, with frequency from currentFreq
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

    const label = document.createElement('div');
    label.className = 'word-label';

    const textSpan = document.createElement('span');
    textSpan.className = 'word-text';
    textSpan.textContent = word;

    const freqBadge = document.createElement('span');
    freqBadge.className = 'word-freq';
    freqBadge.textContent = `×${count}`;

    label.appendChild(textSpan);
    label.appendChild(freqBadge);

    const actions = document.createElement('div');
    actions.className = 'word-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-add';
    addBtn.textContent = 'Add to Known';

    addBtn.addEventListener('click', () => {
      if (knownSet.has(word)) {
        removeKnownWord(word);
        item.classList.remove('word-item--added');
        addBtn.className = 'btn btn-primary btn-add';
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
    item.appendChild(label);
    item.appendChild(actions);
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

// --- Library Overlay ---

function openLibrary() {
  renderLibrary();
  libraryOverlay.classList.remove('hidden');
}

function closeLibrary() {
  libraryOverlay.classList.add('hidden');
}

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
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.style.fontSize = '0.75rem';
    removeBtn.style.padding = '0.3rem 0.6rem';
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

// --- Event Handlers (Library Overlay) ---

openLibraryBtn.addEventListener('click', openLibrary);

closeLibraryBtn.addEventListener('click', closeLibrary);

libraryOverlay.addEventListener('click', (e) => {
  if (e.target === libraryOverlay || e.target.classList.contains('overlay-backdrop')) {
    closeLibrary();
  }
});

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
  closeLibrary();
});
