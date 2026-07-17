import { dbGet, dbPut, dbDelete } from './state.js';

let _dictMap = null;
let _dictName = '';

export function getDictMap() { return _dictMap; }
export function getDictName() { return _dictName; }

export function getDictRank(word) {
  if (!_dictMap) return null;
  return _dictMap.get(word) ?? null;
}

// Callback for when dict changes (set from app.js to avoid circular imports)
let _onChange = null;
export function onDictChange(cb) { _onChange = cb; }
function _notify() { if (_onChange) _onChange(); }

function extractRank(entry) {
  const data = entry[2];
  if (!data) return null;
  if (data.frequency) return data.frequency.value;
  return data.value || null;
}

export async function loadDictionary(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const metaFile = zip.file('term_meta_bank_1.json');
    if (!metaFile) { alert('Dictionary zip must contain term_meta_bank_1.json'); return false; }

    const text = await metaFile.async('string');
    const entries = JSON.parse(text);
    const map = new Map();
    for (const entry of entries) {
      const word = entry[0]?.trim();
      if (!word) continue;
      const rank = extractRank(entry);
      if (rank != null && rank > 0) {
        const existing = map.get(word);
        if (existing == null || rank < existing) map.set(word, rank);
      }
    }
    _dictMap = map;

    const indexFile = zip.file('index.json');
    if (indexFile) {
      try { _dictName = JSON.parse(await indexFile.async('string')).title || 'Dictionary'; }
      catch { _dictName = 'Dictionary'; }
    } else { _dictName = 'Dictionary'; }

    await Promise.all([dbPut('dictName', _dictName), dbPut('dictData', [..._dictMap.entries()])]);
    _notify();
    return true;
  } catch (err) {
    console.error(err);
    alert('Failed to load dictionary.');
    return false;
  }
}

export async function loadDictFromDB() {
  try {
    const [name, data] = await Promise.all([dbGet('dictName'), dbGet('dictData')]);
    if (name && data && Array.isArray(data)) {
      _dictName = name;
      _dictMap = new Map(data);
    }
  } catch (err) { console.warn('Failed to load dict from DB:', err); }
}

export function unloadDictionary() {
  _dictMap = null;
  _dictName = '';
  dbDelete('dictName').catch(() => {});
  dbDelete('dictData').catch(() => {});
  _notify();
}
