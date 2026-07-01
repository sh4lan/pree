const STORAGE_KEY = 'primerKnownWords';

// --- State ---
let knownWords = new Set();
let currentNewWords = [];   // words currently displayed (not yet known)
let currentAllWords = [];   // all words from last file drop (including subsequently marked-known)

// --- DOM refs ---
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const dropStatus = document.getElementById('dropStatus');
const knownCount = document.getElementById('knownCount');
const importKnownBtn = document.getElementById('importKnownBtn');
const exportKnownBtn = document.getElementById('exportKnownBtn');
const clearKnownBtn = document.getElementById('clearKnownBtn');
const knownFileInput = document.getElementById('knownFileInput');
const wordSection = document.getElementById('wordSection');
const wordList = document.getElementById('wordList');
const wordCounter = document.getElementById('wordCounter');
const markAllBtn = document.getElementById('markAllBtn');
const emptyState = document.getElementById('emptyState');

// --- Init ---
loadKnownWords();
renderKnownCount();
updateEmptyState();

// --- Known Words ---

function loadKnownWords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      knownWords = new Set(arr.map(w => w.trim()).filter(Boolean));
    } else {
      knownWords = new Set();
    }
  } catch {
    knownWords = new Set();
  }
}

function saveKnownWords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...knownWords].sort()));
}

function addKnownWord(word) {
  const cleaned = word.trim();
  if (!cleaned) return false;
  knownWords.add(cleaned);
  saveKnownWords();
  renderKnownCount();
  return true;
}

function removeKnownWord(word) {
  knownWords.delete(word.trim());
  saveKnownWords();
  renderKnownCount();
}

function clearAllKnown() {
  if (knownWords.size === 0) return;
  if (!confirm(`Clear all ${knownWords.size} known words?`)) return;
  knownWords.clear();
  saveKnownWords();
  renderKnownCount();
  // Re-filter current display
  if (currentAllWords.length > 0) {
    filterAndRender(currentAllWords);
  }
  updateEmptyState();
}

function importKnownWords(text) {
  // Strip BOM if present
  text = text.replace(/^﻿/, '');
  const words = text.split(/\r?\n/)
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.normalize('NFC'));

  if (words.length === 0) {
    showStatus('No words found in file.', 'error');
    return;
  }

  // Merge, don't replace
  for (const w of words) {
    knownWords.add(w);
  }
  saveKnownWords();
  renderKnownCount();
  showStatus(`Imported ${words.length} known words (${knownWords.size} total).`, 'success');

  // Re-filter current display
  if (currentAllWords.length > 0) {
    filterAndRender(currentAllWords);
  }
  updateEmptyState();
}

function exportKnownWords() {
  if (knownWords.size === 0) {
    showStatus('No known words to export.', 'error');
    return;
  }
  const text = [...knownWords].sort().join('\n');
  downloadTextFile(text, 'known-words.txt');
  showStatus('Known words exported.', 'success');
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
  // Strip BOM
  text = text.replace(/^﻿/, '');
  const words = text.split(/\r?\n/)
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.normalize('NFC'));

  if (words.length === 0) {
    showStatus('File is empty or contains no valid words.', 'error');
    return;
  }

  // Deduplicate within the file
  currentAllWords = [...new Set(words)];
  filterAndRender(currentAllWords);
}

function filterAndRender(allWords) {
  // Filter out already-known words
  currentNewWords = allWords.filter(w => !knownWords.has(w));
  renderWordList(allWords);
  updateEmptyState();
}

// --- Rendering ---

function renderWordList(allWords) {
  wordList.innerHTML = '';

  if (allWords.length === 0) {
    wordSection.classList.add('hidden');
    return;
  }

  wordSection.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // Update counter
  const remaining = allWords.filter(w => !knownWords.has(w)).length;
  wordCounter.textContent = `${remaining} / ${allWords.length} remaining`;

  // Mark All button
  markAllBtn.disabled = remaining === 0;

  // Render each word
  for (const word of allWords) {
    const isKnown = knownWords.has(word);
    const item = document.createElement('div');
    item.className = `word-item${isKnown ? ' known' : ''}`;
    item.dataset.word = word;

    const textSpan = document.createElement('span');
    textSpan.className = 'word-text';
    textSpan.textContent = word;

    const actions = document.createElement('div');
    actions.className = 'word-actions';

    // Add/Added button
    const addBtn = document.createElement('button');
    if (isKnown) {
      addBtn.className = 'btn btn-added';
      addBtn.textContent = 'Known';
    } else {
      addBtn.className = 'btn btn-primary btn-add';
      addBtn.textContent = 'Add to Known';
      addBtn.addEventListener('click', () => {
        addKnownWord(word);
        item.classList.add('known');
        addBtn.className = 'btn btn-added';
        addBtn.textContent = 'Known';
        updateCounter();
        markAllBtn.disabled = allWords.every(w => knownWords.has(w));
      });
    }

    // Remove from known (only for words that started this session as known)
    if (isKnown && currentAllWords.includes(word)) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-danger';
      removeBtn.textContent = 'Remove';
      removeBtn.style.fontSize = '0.75rem';
      removeBtn.style.padding = '0.3rem 0.6rem';
      removeBtn.addEventListener('click', () => {
        removeKnownWord(word);
        item.classList.remove('known');
        item.querySelector('.btn-added')?.remove();
        actions.innerHTML = '';
        const newAddBtn = document.createElement('button');
        newAddBtn.className = 'btn btn-primary btn-add';
        newAddBtn.textContent = 'Add to Known';
        newAddBtn.addEventListener('click', () => {
          addKnownWord(word);
          item.classList.add('known');
          newAddBtn.className = 'btn btn-added';
          newAddBtn.textContent = 'Known';
          updateCounter();
          markAllBtn.disabled = currentAllWords.every(w => knownWords.has(w));
        });
        actions.appendChild(newAddBtn);
        updateCounter();
        markAllBtn.disabled = currentAllWords.every(w => knownWords.has(w));
      });
      actions.appendChild(removeBtn);
    }

    actions.appendChild(addBtn);
    item.appendChild(textSpan);
    item.appendChild(actions);
    wordList.appendChild(item);
  }
}

function updateCounter() {
  const remaining = currentAllWords.filter(w => !knownWords.has(w)).length;
  wordCounter.textContent = `${remaining} / ${currentAllWords.length} remaining`;
}

function renderKnownCount() {
  knownCount.textContent = knownWords.size;
}

function updateEmptyState() {
  const hasWords = currentAllWords.length > 0;
  wordSection.classList.toggle('hidden', !hasWords);
  emptyState.classList.toggle('hidden', hasWords);
}

// --- Event Handlers ---

// Drop zone
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
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFile(files[0]);
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
    showStatus('Please drop a .txt file.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    processNewWordsFile(text);
    showStatus(`Loaded ${currentAllWords.length} words from "${file.name}".`, 'success');
  };
  reader.onerror = () => {
    showStatus('Error reading file.', 'error');
  };
  reader.readAsText(file, 'UTF-8');
}

// Known words import/export
importKnownBtn.addEventListener('click', () => knownFileInput.click());

knownFileInput.addEventListener('change', () => {
  if (knownFileInput.files.length > 0) {
    const reader = new FileReader();
    reader.onload = (e) => importKnownWords(e.target.result);
    reader.readAsText(knownFileInput.files[0], 'UTF-8');
    knownFileInput.value = '';
  }
});

exportKnownBtn.addEventListener('click', exportKnownWords);

clearKnownBtn.addEventListener('click', clearAllKnown);

// Mark All as Known
markAllBtn.addEventListener('click', () => {
  for (const word of currentAllWords) {
    addKnownWord(word);
  }
  // Re-render to update all items
  renderWordList(currentAllWords);
  updateEmptyState();
  showStatus(`Marked all ${currentAllWords.length} words as known.`, 'success');
});

// --- Helpers ---

function showStatus(message, type) {
  dropStatus.textContent = message;
  dropStatus.className = 'status-message';
  if (type) dropStatus.classList.add(type);
  // Clear after 4 seconds
  clearTimeout(window._statusTimeout);
  window._statusTimeout = setTimeout(() => {
    dropStatus.textContent = '';
    dropStatus.className = 'status-message';
  }, 4000);
}
