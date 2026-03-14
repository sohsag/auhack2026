// Nerdata content script — injected into AWS Athena console

let generatedSQL = null;

// ── Inject floating UI ────────────────────────────────────────────────────────

const bar = document.createElement('div');
bar.id = 'nerdata-bar';
bar.innerHTML = `
  <div id="nerdata-panel" class="hidden">
    <div id="nerdata-header">
      <span id="nerdata-title">Nerdata</span>
    </div>
    <textarea id="nerdata-input" rows="2" placeholder="e.g. Show total sales by region for Q1 2024"></textarea>
    <div id="nerdata-sql-preview"></div>
    <div id="nerdata-actions">
      <button id="nerdata-generate">Generate SQL</button>
      <button id="nerdata-insert">Insert ↵</button>
    </div>
    <div id="nerdata-status"></div>
  </div>
  <button id="nerdata-toggle" title="Nerdata">⌗</button>
`;
document.body.appendChild(bar);

const panel     = document.getElementById('nerdata-panel');
const toggle    = document.getElementById('nerdata-toggle');
const input     = document.getElementById('nerdata-input');
const generateBtn = document.getElementById('nerdata-generate');
const insertBtn = document.getElementById('nerdata-insert');
const preview   = document.getElementById('nerdata-sql-preview');
const status    = document.getElementById('nerdata-status');

toggle.addEventListener('click', () => panel.classList.toggle('hidden'));

// ── Generate ──────────────────────────────────────────────────────────────────

generateBtn.addEventListener('click', async () => {
  const prompt = input.value.trim();
  if (!prompt) return;

  generatedSQL = null;
  preview.style.display = 'none';
  insertBtn.style.display = 'none';
  generateBtn.disabled = true;
  setStatus('Generating SQL…');

  try {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'GENERATE_SQL', prompt });
    } catch {
      throw new Error('Extension was reloaded — please refresh this page.');
    }
    if (response.error) throw new Error(response.error);

    generatedSQL = response.sql;
    preview.textContent = generatedSQL;
    preview.style.display = 'block';
    insertBtn.style.display = 'block';
    setStatus('Ready to insert.');
  } catch (err) {
    setStatus('Error: ' + err.message);
  } finally {
    generateBtn.disabled = false;
  }
});

// ── Insert into Ace editor ────────────────────────────────────────────────────

insertBtn.addEventListener('click', insertSQL);

function insertSQL() {
  if (!generatedSQL) return;

  // Focus the hidden textarea Ace uses as its real input
  const textInput = document.querySelector('.ace_text-input');
  if (!textInput) { setStatus('Editor not found'); return; }

  textInput.focus();

  // Select all then replace via execCommand (works in content script world)
  document.execCommand('selectAll');
  document.execCommand('insertText', false, generatedSQL);

  setStatus('Inserted ✓');
  setTimeout(() => setStatus(''), 2000);
}

// Enter = generate, Shift+Enter = newline
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    generateBtn.click();
  }
});

function setStatus(msg) {
  status.textContent = msg;
}
