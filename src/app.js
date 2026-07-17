import { loadKnownWords, setTheme, getTheme } from './state.js';
import { loadDictFromDB, onDictChange } from './dict.js';
import { initPrimer, renderStats, renderDictUI, reprime } from './primer.js';

// --- Theme button ---
const themeBtn = document.getElementById('themeBtn');
setTheme(getTheme());
themeBtn.textContent = getTheme() === 'dark' ? 'Light' : 'Dark';
themeBtn.addEventListener('click', () => {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  themeBtn.textContent = next === 'dark' ? 'Light' : 'Dark';
});

// --- Version ---
document.getElementById('version').textContent = 'v20260717';

// --- Init ---
loadKnownWords();
initPrimer();
renderStats();
renderDictUI();

loadDictFromDB().then(() => {
  renderStats();
  renderDictUI();
  reprime();
});
