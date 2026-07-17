import { getSessionList, getSessionText, deleteSession, formatDate } from './state.js';

const sessionList = document.getElementById('sessionList');
const sessionEmpty = document.getElementById('sessionEmpty');

function formatRelTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 2592000000) return Math.floor(diff / 86400000) + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function render() {
  const sessions = await getSessionList();
  sessionList.innerHTML = '';

  if (!sessions.length) {
    sessionList.classList.add('hidden');
    sessionEmpty.classList.remove('hidden');
    return;
  }
  sessionList.classList.remove('hidden');
  sessionEmpty.classList.add('hidden');

  for (const session of sessions) {
    const item = document.createElement('div');
    item.className = 'word-item';

    const textSpan = document.createElement('span');
    textSpan.className = 'word-text';
    const sentCount = session.sentences?.length || 0;
    const wordCount = session.wordIndices ? Object.keys(session.wordIndices).length : 0;
    textSpan.textContent = `${sentCount} sentences · ${wordCount} unique words`;

    const dateSpan = document.createElement('span');
    dateSpan.className = 'word-date';
    dateSpan.textContent = formatRelTime(session.ts);

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-text';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', async () => {
      const text = await getSessionText(session.id);
      if (text) {
        sessionStorage.setItem('primerPasteText', text);
        sessionStorage.setItem('primerAutoExtract', 'true');
        window.location.href = 'index.html';
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-text btn-text-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      await deleteSession(session.id);
      render();
    });

    const actions = document.createElement('div');
    actions.className = 'word-actions';
    actions.appendChild(dateSpan);
    actions.appendChild(restoreBtn);
    actions.appendChild(delBtn);

    item.appendChild(textSpan);
    item.appendChild(actions);
    sessionList.appendChild(item);
  }
}

render();
