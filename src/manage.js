import { loadKnownWords, getKnownWords, getKnownSet, addKnownWord, removeKnownWord, formatDate, downloadTextFile } from './state.js';
import { loadDictFromDB, getDictMap, getDictName, loadDictionary, unloadDictionary, onDictChange } from './dict.js';

const libraryList = document.getElementById('libraryList');
const libraryEmpty = document.getElementById('libraryEmpty');
const libraryKnownCount = document.getElementById('libraryKnownCount');
const libraryImportBtn = document.getElementById('libraryImportBtn');
const libraryExportBtn = document.getElementById('libraryExportBtn');
const libraryFileInput = document.getElementById('libraryFileInput');
const dictBar = document.getElementById('dictBar');
const dictBtn = document.getElementById('dictBtn');
const dictFileInput = document.getElementById('dictFileInput');
const dictModal = document.getElementById('dictModal');
const uploadDictBtn = document.getElementById('uploadDictBtn');
const removeDictOption = document.getElementById('removeDictOption');
const removeDictBtn = document.getElementById('removeDictBtn');
const dictModalStatus = document.getElementById('dictModalStatus');

// --- Render ---
function renderLibrary() {
  const entries = [...getKnownWords().entries()]
    .map(([w, t]) => ({ word: w, ts: new Date(t) }))
    .sort((a, b) => b.ts - a.ts);

  libraryList.innerHTML = '';
  libraryKnownCount.textContent = getKnownSet().size;

  if (!entries.length) {
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

function renderDictUI() {
  if (getDictMap()) {
    dictBar.textContent = `${getDictName()} (${getDictMap().size.toLocaleString()} entries)`;
    dictBar.classList.remove('hidden');
  } else {
    dictBar.classList.add('hidden');
  }
}

// --- Dict modal ---
function openDictModal() {
  dictModal.classList.remove('hidden');
  if (getDictMap()) {
    dictModalStatus.textContent = `Loaded: ${getDictName()} (${getDictMap().size.toLocaleString()} entries)`;
    removeDictOption.classList.remove('hidden');
  } else {
    dictModalStatus.textContent = 'No dictionary loaded.';
    removeDictOption.classList.add('hidden');
  }
}
function closeDictModal() { dictModal.classList.add('hidden'); }

dictBtn.addEventListener('click', openDictModal);
dictModal.querySelector('.modal-backdrop').addEventListener('click', closeDictModal);
dictModal.querySelector('.modal-close').addEventListener('click', closeDictModal);
removeDictBtn.addEventListener('click', () => { unloadDictionary(); closeDictModal(); renderDictUI(); });
uploadDictBtn.addEventListener('click', () => dictFileInput.click());
dictFileInput.addEventListener('change', () => {
  if (dictFileInput.files.length) {
    loadDictionary(dictFileInput.files[0]).then(() => { closeDictModal(); renderDictUI(); });
    dictFileInput.value = '';
  }
});

// --- Import/Export ---
function importKnownWords(text) {
  text = text.replace(/^﻿/, '');
  const words = text.split(/\r?\n/).map(w => w.trim()).filter(Boolean).map(w => w.normalize('NFC'));
  if (!words.length) { alert('No words found.'); return; }
  let added = 0;
  for (const w of words) {
    if (!getKnownSet().has(w)) { addKnownWord(w); added++; }
  }
  if (added) renderLibrary();
}

function exportKnownWords() {
  if (!getKnownSet().size) { alert('No known words.'); return; }
  downloadTextFile([...getKnownSet()].sort().join('\n'), 'known-words.txt');
}

libraryImportBtn.addEventListener('click', () => libraryFileInput.click());
libraryFileInput.addEventListener('change', () => {
  if (!libraryFileInput.files.length) return;
  const reader = new FileReader();
  reader.onload = (e) => importKnownWords(e.target.result);
  reader.readAsText(libraryFileInput.files[0], 'UTF-8');
  libraryFileInput.value = '';
});
libraryExportBtn.addEventListener('click', exportKnownWords);

// --- Init ---
loadKnownWords();
renderLibrary();
renderDictUI();
loadDictFromDB().then(() => { renderDictUI(); });
