import {
  getKnownWords, getKnownSet, getCurrentAllWords, getCurrentFreq, getOriginalText,
  getHideKanaOnly, setCurrentAllWords, setCurrentFreq, setOriginalText,
  setHideKanaOnly,
  dbPut, dbGet, addKnownWord, removeKnownWord, getTokenizer,
  CONTENT_POS, isKanaOnly, escapeHtml, downloadTextFile, highlightWord, findSentences
} from './state.js';
import { getDictRank, getDictMap, getDictName } from './dict.js';

const PASTE_KEY = 'primerPasteText';

// --- DOM refs ---
const pasteTextarea = document.getElementById('pasteTextarea');
const extractBtn = document.getElementById('extractBtn');
const uploadBtn = document.getElementById('uploadBtn');
const downloadBtn = document.getElementById('downloadBtn');
const pasteStatus = document.getElementById('pasteStatus');
const sortSelect = document.getElementById('sortSelect');
const hideKanaCheckbox = document.getElementById('hideKanaCheckbox');
const wordSection = document.getElementById('wordSection');
const wordList = document.getElementById('wordList');
const emptyState = document.getElementById('emptyState');
const restoreBtn = document.getElementById('restoreBtn');
const hasSavedBadge = document.getElementById('hasSavedBadge');

// Upload modal
const uploadModal = document.getElementById('uploadModal');
const uploadDropZone = document.getElementById('uploadDropZone');
const uploadModalInput = document.getElementById('uploadModalInput');
const uploadModalStatus = document.getElementById('uploadModalStatus');

const contextModal = document.getElementById('contextModal');
const contextWordTitle = document.getElementById('contextWordTitle');
const contextSentences = document.getElementById('contextSentences');
const downloadModal = document.getElementById('downloadModal');

// --- Render helpers ---
export function renderStats() {
  const el = document.getElementById('knownCount');
  if (el) el.textContent = getKnownSet().size;
  const el2 = document.getElementById('libraryKnownCount');
  if (el2) el2.textContent = getKnownSet().size;
}

export function updatePrimerUI() {
  const hasWords = wordList.children.length > 0;
  wordSection.classList.toggle('hidden', !hasWords);
  emptyState.classList.toggle('hidden', hasWords);
  const msg = emptyState.querySelector('p');
  if (!hasWords && getCurrentAllWords().length > 0) {
    msg.textContent = 'All words are already in your known list or excluded by the current filter.';
  } else {
    msg.textContent = 'No new words to show. Paste some text above to get started.';
  }
}

export function renderDictUI() {
  const el = document.getElementById('dictBar');
  if (!el) return;
  if (getDictMap()) {
    el.textContent = `${getDictName()} (${getDictMap().size.toLocaleString()} entries)`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// --- Extract ---
export async function extractFromPaste(text) {
  text = text.replace(/^﻿/, '').trim();
  if (!text) { pasteStatus.textContent = 'No text to process.'; return; }

  setOriginalText(text);
  pasteStatus.textContent = 'Tokenizing...';

  try {
    const tokenizer = await getTokenizer();
    const lines = text.split('\n');
    const wordMap = new Map();
    let totalTokens = 0;

    for (let i = 0; i < lines.length; i += 20) {
      const chunk = lines.slice(i, i + 20).join('\n');
      const tokens = tokenizer.tokenize(chunk);
      totalTokens += tokens.length;
      for (const t of tokens) {
        if (!CONTENT_POS.has(t.pos)) continue;
        const word = (t.pos === '動詞' || t.pos === '形容詞')
          ? (t.basic_form || t.surface_form).trim()
          : t.surface_form.trim();
        if (!word || /^[^　-鿿豈-﫿a-zA-Z]+$/.test(word)) continue;
        wordMap.set(word, (wordMap.get(word) || 0) + 1);
      }
      await new Promise(r => setTimeout(r, 0));
    }

    const entries = [...wordMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([word, count]) => ({ word, count }));

    if (!entries.length) { pasteStatus.textContent = 'No words could be extracted.'; return; }

    setCurrentAllWords(entries.map(e => e.word));
    setCurrentFreq(entries);

    applyFilters();
    pasteStatus.textContent = `Extracted ${entries.length} unique words (${totalTokens} tokens).`;
    downloadBtn.classList.remove('hidden');

    dbPut('lastText', text).catch(() => {});
    if (hasSavedBadge) hasSavedBadge.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    pasteStatus.textContent = err.message || 'Failed to tokenize text.';
  }
}

// --- Subtitle ---
function extractTextFromSRT(text) {
  return text.replace(/^\d+\s*\n\d{2}:\d{2}:\d{2}[,\.]\d{3}.*?-->.*?\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*\n/gm, '')
    .replace(/<[^>]+>/g, '').replace(/\{\\[^}]+}/g, '').replace(/&nbsp;/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}
function extractTextFromASS(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('Dialogue:')) continue;
    const parts = t.split(',');
    if (parts.length >= 10) lines.push(parts.slice(9).join(',').replace(/\{[^}]+\}/g, '').replace(/\\N/gi, '\n').trim());
  }
  return lines.filter(Boolean).join('\n');
}
function extractTextFromFile(file, text) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.srt')) return extractTextFromSRT(text);
  if (n.endsWith('.ssa') || n.endsWith('.ass')) return extractTextFromASS(text);
  return text;
}

// --- Filter ---
export function applyFilters(sortOverride) {
  let entries = getCurrentFreq().slice().filter(e => !getKnownSet().has(e.word));
  if (getHideKanaOnly()) entries = entries.filter(e => !isKanaOnly(e.word));

  const mode = sortOverride || sortSelect.value || 'count';
  if (mode === 'rank' && getDictMap()) {
    entries.sort((a, b) => {
      const ra = getDictRank(a.word), rb = getDictRank(b.word);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1; if (rb != null) return 1;
      return b.count - a.count;
    });
  } else if (mode === 'chrono') {
    entries.sort((a, b) => {
      const km = getKnownWords();
      const ta = km.has(a.word) ? km.get(a.word) : null;
      const tb = km.has(b.word) ? km.get(b.word) : null;
      if (ta && tb) return new Date(tb) - new Date(ta);
      if (ta) return 1; if (tb) return -1;
      return b.count - a.count;
    });
  } else {
    entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (!getDictMap()) return 0;
      const ra = getDictRank(a.word), rb = getDictRank(b.word);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1; if (rb != null) return 1;
      return 0;
    });
  }
  renderWordList(entries);
  updatePrimerUI();
}

export function reprime() {
  if (getCurrentAllWords().length > 0) applyFilters();
  else updatePrimerUI();
}

// --- Render word list ---
function renderWordList(entries) {
  wordList.innerHTML = '';
  if (!entries.length) { wordSection.classList.add('hidden'); return; }
  wordSection.classList.remove('hidden');
  emptyState.classList.add('hidden');

  const ks = getKnownSet();
  for (const { word, count } of entries) {
    const item = document.createElement('div');
    item.className = 'word-item';
    if (ks.has(word)) item.classList.add('word-item--added');

    const label = document.createElement('span');
    label.className = 'word-label';
    const span = document.createElement('span');
    span.className = 'word-text';
    span.textContent = word;
    label.appendChild(span);
    if (count > 0) {
      const b = document.createElement('span');
      b.className = 'word-freq'; b.textContent = `×${count}`; label.appendChild(b);
    }

    const right = document.createElement('div');
    right.className = 'word-right';
    const rv = getDictRank(word);
    if (rv != null) {
      const r = document.createElement('span');
      r.className = 'word-rank'; r.textContent = `#${rv}`; right.appendChild(r);
    }

    const actions = document.createElement('div');
    actions.className = 'word-actions';

    const addBtn = document.createElement('button');
    if (ks.has(word)) { addBtn.className = 'btn btn-undo-text'; addBtn.textContent = 'Undo'; }
    else { addBtn.className = 'btn btn-add'; addBtn.textContent = 'Add'; }
    addBtn.addEventListener('click', () => {
      if (getKnownSet().has(word)) { removeKnownWord(word); item.classList.remove('word-item--added'); addBtn.className = 'btn btn-add'; addBtn.textContent = 'Add'; }
      else { addKnownWord(word); item.classList.add('word-item--added'); addBtn.className = 'btn btn-undo-text'; addBtn.textContent = 'Undo'; }
      renderStats();
    });

    const moreBtn = document.createElement('button');
    moreBtn.className = 'btn btn-text';
    moreBtn.textContent = 'More';
    moreBtn.addEventListener('click', () => openContextModal(word));

    actions.appendChild(addBtn);
    actions.appendChild(moreBtn);
    right.appendChild(actions);
    item.appendChild(label);
    item.appendChild(right);
    wordList.appendChild(item);
  }
}

// --- Context modal ---
export function openContextModal(word) {
  const sentences = findSentences(word);
  contextWordTitle.textContent = word;
  contextSentences.innerHTML = '';
  if (!sentences.length) {
    contextSentences.innerHTML = '<p class="no-context-msg">No sentences found containing this word.</p>';
  } else {
    for (let i = 0; i < sentences.length; i++) {
      const d = document.createElement('div');
      d.className = 'sentence-item';
      d.innerHTML = `<span class="sentence-marker">${i + 1}.</span> ${highlightWord(sentences[i], word)}`;
      contextSentences.appendChild(d);
    }
  }
  contextModal.classList.remove('hidden');
}
function closeContextModal() { contextModal.classList.add('hidden'); }

// --- Download modal ---
export function openDownloadModal() { downloadModal.classList.remove('hidden'); }
function closeDownloadModal() { downloadModal.classList.add('hidden'); }

function getVisible() {
  return getCurrentFreq().filter(e => !getKnownSet().has(e.word)).filter(e => getHideKanaOnly() ? !isKanaOnly(e.word) : true);
}
function downloadWeighted() {
  const e = getVisible(); const l = [];
  for (const { word, count } of e) for (let i = 0; i < count; i++) l.push(word);
  downloadTextFile(l.join('\n'), 'weighted-words.txt'); closeDownloadModal();
}
function downloadUnique() {
  const e = getVisible(); const l = [];
  for (const { word, count } of e) for (let i = 0; i < count; i++) l.push(word);
  const s = new Set(); const d = [];
  for (const w of l) { if (!s.has(w)) { s.add(w); d.push(w); } }
  downloadTextFile(d.join('\n'), 'unique-words.txt'); closeDownloadModal();
}
function downloadCSV() {
  const e = getVisible(); const BOM = '﻿'; const rows = ['word,count,sentences'];
  for (const { word, count } of e) {
    const s = findSentences(word); const str = s.join(' | ');
    rows.push(`"${word}","${count}","${str.replace(/"/g, '""')}"`);
  }
  downloadTextFile(BOM + rows.join('\n'), 'words-with-sentences.csv'); closeDownloadModal();
}

// --- Restore ---
async function checkSavedText() {
  try { if (await dbGet('lastText') && hasSavedBadge) hasSavedBadge.classList.remove('hidden'); } catch {}
}
restoreBtn.addEventListener('click', async () => {
  try { const s = await dbGet('lastText'); if (s) { pasteTextarea.value = s; pasteStatus.textContent = 'Restored last text.'; } } catch {}
});

// --- Event handlers ---
extractBtn.addEventListener('click', () => {
  const text = pasteTextarea.value;
  sessionStorage.setItem(PASTE_KEY, text);
  extractFromPaste(text);
});

sortSelect.addEventListener('change', () => {
  applyFilters(sortSelect.value);
});

hideKanaCheckbox.addEventListener('change', () => { setHideKanaOnly(hideKanaCheckbox.checked); localStorage.setItem('primerHideKana', getHideKanaOnly()); if (getCurrentAllWords().length) applyFilters(); });
downloadBtn.addEventListener('click', openDownloadModal);

// Upload modal
uploadBtn.addEventListener('click', () => { uploadModal.classList.remove('hidden'); uploadModalStatus.textContent = ''; });

function closeUploadModal() { uploadModal.classList.add('hidden'); }
uploadModal.querySelector('.modal-backdrop').addEventListener('click', closeUploadModal);
uploadModal.querySelector('.modal-close').addEventListener('click', closeUploadModal);

uploadDropZone.addEventListener('click', () => uploadModalInput.click());
uploadDropZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadDropZone.classList.add('drag-over'); });
uploadDropZone.addEventListener('dragleave', () => { uploadDropZone.classList.remove('drag-over'); });
uploadDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadDropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) handleUploadFile(e.dataTransfer.files[0]);
});

uploadModalInput.addEventListener('change', () => {
  if (uploadModalInput.files.length > 0) { handleUploadFile(uploadModalInput.files[0]); uploadModalInput.value = ''; }
});

function handleUploadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = extractTextFromFile(file, e.target.result);
    if (!text.trim()) { uploadModalStatus.textContent = 'No text could be extracted.'; return; }
    pasteTextarea.value = text;
    sessionStorage.setItem(PASTE_KEY, text);
    uploadModalStatus.textContent = `Loaded "${file.name}" (${text.split('\n').length} lines).`;
    closeUploadModal();
    extractFromPaste(text);
  };
  reader.readAsText(file, 'UTF-8');
}

contextModal.querySelector('.modal-backdrop').addEventListener('click', closeContextModal);
contextModal.querySelector('.modal-close').addEventListener('click', closeContextModal);
downloadModal.querySelector('.modal-backdrop').addEventListener('click', closeDownloadModal);
downloadModal.querySelector('.modal-close').addEventListener('click', closeDownloadModal);
downloadModal.querySelectorAll('.download-option').forEach(opt => {
  opt.querySelector('.download-btn').addEventListener('click', () => {
    const f = opt.dataset.format;
    if (f === 'weighted') downloadWeighted();
    else if (f === 'unique') downloadUnique();
    else if (f === 'csv') downloadCSV();
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!contextModal.classList.contains('hidden')) closeContextModal();
    if (!downloadModal.classList.contains('hidden')) closeDownloadModal();
  }
});

// --- Init ---
export function initPrimer() {
  hideKanaCheckbox.checked = getHideKanaOnly();
  updatePrimerUI();
  checkSavedText();

  // Restore paste text from sessionStorage
  const saved = sessionStorage.getItem(PASTE_KEY);
  if (saved) pasteTextarea.value = saved;

  // Auto-save paste text on input
  pasteTextarea.addEventListener('input', () => {
    sessionStorage.setItem(PASTE_KEY, pasteTextarea.value);
  });
}
