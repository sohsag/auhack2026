// Nerdata content script — injected into AWS Athena console

let generatedSQL = null;
let conversationHistory = [];

// ── Inject floating UI ────────────────────────────────────────────────────────

const bar = document.createElement('div');
bar.id = 'nerdata-bar';
bar.innerHTML = `
  <div id="nerdata-panel" class="hidden">
    <div id="nerdata-header">
      <span id="nerdata-title">Nerdata</span>
      <button id="nerdata-clear" title="Clear conversation">↺</button>
    </div>
    <div id="nerdata-history"></div>
    <div id="nerdata-input-row">
      <textarea id="nerdata-input" rows="2" placeholder="Ask about your data… (Enter to send)"></textarea>
    </div>
    <div id="nerdata-status"></div>
  </div>
  <button id="nerdata-toggle" title="Nerdata">⌗</button>
`;
document.body.appendChild(bar);

const panel     = document.getElementById('nerdata-panel');
const toggle    = document.getElementById('nerdata-toggle');
const input     = document.getElementById('nerdata-input');
const history   = document.getElementById('nerdata-history');
const clearBtn  = document.getElementById('nerdata-clear');
const status    = document.getElementById('nerdata-status');

toggle.addEventListener('click', () => {
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) input.focus();
});

clearBtn.addEventListener('click', () => {
  conversationHistory = [];
  generatedSQL = null;
  history.innerHTML = '';
  setStatus('');
});

// ── Chat UI helpers ───────────────────────────────────────────────────────────

function addMessage(role, content) {
  const msg = document.createElement('div');
  msg.className = `nerdata-msg nerdata-msg-${role}`;
  msg.textContent = content;
  history.appendChild(msg);
  history.scrollTop = history.scrollHeight;
  return msg;
}

function addSQLBlock(sql) {
  const wrap = document.createElement('div');
  wrap.className = 'nerdata-sql-wrap';
  wrap.innerHTML = `<pre class="nerdata-sql-preview">${escapeHtml(sql)}</pre>
    <button class="nerdata-insert-btn">Insert into editor ↵</button>`;
  wrap.querySelector('.nerdata-insert-btn').addEventListener('click', () => insertSQL(sql));
  history.appendChild(wrap);
  history.scrollTop = history.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Generate ──────────────────────────────────────────────────────────────────

async function generate() {
  const prompt = input.value.trim();
  if (!prompt) return;

  input.value = '';
  addMessage('user', prompt);
  const thinking = addMessage('assistant', '…');
  setStatus('Generating…');

  conversationHistory.push({ role: 'user', content: prompt });

  try {
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'GENERATE_SQL',
        prompt,
        history: conversationHistory,
      });
    } catch {
      throw new Error('Extension was reloaded — please refresh this page.');
    }
    if (response.error) throw new Error(response.error);

    generatedSQL = response.sql;
    conversationHistory.push({ role: 'assistant', content: response.sql });

    thinking.remove();
    addSQLBlock(generatedSQL);
    setStatus('');
  } catch (err) {
    thinking.remove();
    addMessage('assistant', 'Error: ' + err.message);
    setStatus('');
  }
}

// ── Insert into Ace editor ────────────────────────────────────────────────────

function insertSQL(sql) {
  const textInput = document.querySelector('.ace_text-input');
  if (!textInput) { setStatus('Editor not found'); return; }

  textInput.focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, sql);

  setStatus('Inserted ✓');
  setTimeout(() => setStatus(''), 2000);
}

// ── Input handlers ────────────────────────────────────────────────────────────

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    generate();
  }
});

function setStatus(msg) {
  status.textContent = msg;
}
