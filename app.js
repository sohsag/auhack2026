const chatWindow = document.getElementById('chat-window');
const inputForm = document.getElementById('input-area');
const userInput = document.getElementById('user-input');
const apiKeyInput = document.getElementById('api-key');
const mcpUrlInput = document.getElementById('mcp-url');
const providerSelect = document.getElementById('provider');
const dbUrlInput = document.getElementById('db-url');
const dbStatus = document.getElementById('db-status');

// ── Persistence ───────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
  const savedKey = localStorage.getItem('llm_api_key');
  const savedUrl = localStorage.getItem('mcp_url');
  const savedProvider = localStorage.getItem('llm_provider');
  const savedDbUrl = localStorage.getItem('db_url');
  if (savedKey) apiKeyInput.value = savedKey;
  if (savedUrl) mcpUrlInput.value = savedUrl;
  if (savedProvider) providerSelect.value = savedProvider;
  if (savedDbUrl) dbUrlInput.value = savedDbUrl;
  updateKeyPlaceholder();
  await checkServerStatus();
});

const PLACEHOLDERS = { anthropic: 'sk-ant-...', openai: 'sk-...', gemini: 'AIza...', kimi: 'sk-...', groq: 'gsk_...', 'groq-llama': 'gsk_...' };
function updateKeyPlaceholder() {
  apiKeyInput.placeholder = PLACEHOLDERS[providerSelect.value] || 'API key...';
}

apiKeyInput.addEventListener('change', () => localStorage.setItem('llm_api_key', apiKeyInput.value.trim()));
dbUrlInput.addEventListener('change', () => localStorage.setItem('db_url', dbUrlInput.value.trim()));
providerSelect.addEventListener('change', () => {
  localStorage.setItem('llm_provider', providerSelect.value);
  updateKeyPlaceholder();
});
mcpUrlInput.addEventListener('change', async () => {
  localStorage.setItem('mcp_url', mcpUrlInput.value.trim());
  await checkServerStatus();
});

async function checkServerStatus() {
  const url = mcpUrlInput.value.trim() || 'http://localhost:3000';
  try {
    const res = await fetch(`${url}/health`);
    if (res.ok) setStatus(true);
    else setStatus(false);
  } catch {
    setStatus(false);
  }
}

function setStatus(connected) {
  dbStatus.innerHTML = connected
    ? `<span class="relative flex h-1.5 w-1.5">
         <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60"></span>
         <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent"></span>
       </span>
       <span class="text-xs font-mono text-white/30">Connected</span>`
    : `<span class="relative flex h-1.5 w-1.5">
         <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60"></span>
         <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
       </span>
       <span class="text-xs font-mono text-white/30">Disconnected</span>`;
}

// ── UI Helpers ────────────────────────────────────────────────────────────────

function appendMessage(html, role = 'assistant') {
  const wrap = document.createElement('div');
  wrap.className = `animate-fade-up ${role === 'user' ? 'flex justify-end' : 'max-w-2xl'}`;
  wrap.innerHTML = html;
  chatWindow.appendChild(wrap);
  chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: 'smooth' });
  return wrap;
}

function userBubble(text) {
  return appendMessage(
    `<div class="bg-muted border border-border rounded-xl rounded-br-sm px-4 py-3 text-sm text-white/80 max-w-xl">${escapeHtml(text)}</div>`,
    'user'
  );
}

function thinkingBubble() {
  return appendMessage(`
    <div class="flex items-start gap-3">
      <div class="w-6 h-6 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 mt-0.5">
        <svg class="w-3 h-3 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
        </svg>
      </div>
      <div class="bg-panel border border-border rounded-xl rounded-tl-sm px-4 py-3 text-sm text-white/40 italic" id="thinking-text">
        Thinking…
      </div>
    </div>`
  );
}

function appendToBubble(bubble, html) {
  bubble.querySelector('#thinking-text')?.closest('div')?.remove();
  bubble.insertAdjacentHTML('beforeend', html);
}

function sqlBlock(sql) {
  return `<pre class="mt-2 bg-surface border border-border rounded-lg px-4 py-3 text-xs font-mono text-accent overflow-x-auto whitespace-pre-wrap">${escapeHtml(sql)}</pre>`;
}

function resultsTable(columns, rows) {
  if (!rows.length) return `<p class="mt-2 text-xs text-white/30 font-mono">No results.</p>`;
  const headers = columns.map(c => `<th class="px-3 py-2 text-left text-[10px] font-mono text-white/30 uppercase tracking-wider border-b border-border">${escapeHtml(c)}</th>`).join('');
  const bodyRows = rows.slice(0, 50).map(row =>
    `<tr class="border-b border-border/50 hover:bg-white/[0.02]">
      ${columns.map(c => `<td class="px-3 py-2 text-xs font-mono text-white/60 whitespace-nowrap">${escapeHtml(String(row[c] ?? ''))}</td>`).join('')}
    </tr>`
  ).join('');
  const truncated = rows.length > 50 ? `<p class="text-[10px] font-mono text-white/20 mt-1">${rows.length - 50} more rows not shown.</p>` : '';
  return `
    <div class="mt-2 overflow-x-auto rounded-lg border border-border">
      <table class="min-w-full">${'<thead><tr>' + headers + '</tr></thead>'}<tbody>${bodyRows}</tbody></table>
    </div>${truncated}`;
}

function assistantText(text) {
  const html = marked.parse(text);
  return `<div class="bg-panel border border-border rounded-xl rounded-tl-sm px-4 py-3 text-sm text-white/70 leading-relaxed prose prose-invert prose-sm max-w-none">${html}</div>`;
}

function errorBubble(msg) {
  return `<div class="mt-2 bg-red-950/40 border border-red-800/40 rounded-lg px-4 py-3 text-xs font-mono text-red-400">${escapeHtml(msg)}</div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── MCP Tool Executors ────────────────────────────────────────────────────────

function dbHeaders() {
  const dbUrl = dbUrlInput.value.trim();
  return dbUrl ? { 'x-database-url': dbUrl } : {};
}

async function getSchema() {
  const base = mcpUrlInput.value.trim() || 'http://localhost:3000';
  const res = await fetch(`${base}/schema`, { headers: dbHeaders() });
  if (!res.ok) throw new Error('Could not fetch schema from MCP server');
  return await res.json();
}

async function runSql(sql) {
  const base = mcpUrlInput.value.trim() || 'http://localhost:3000';
  const res = await fetch(`${base}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...dbHeaders() },
    body: JSON.stringify({ sql }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Query failed');
  return data;
}

// ── Conversation History ──────────────────────────────────────────────────────

const history = { anthropic: [], openai: [], gemini: [] };

function historyFor(provider) {
  if (provider === 'anthropic') return history.anthropic;
  if (provider === 'gemini') return history.gemini;
  return history.openai; // openai, kimi, groq, groq-llama all share the format
}

// Reset history when provider changes so stale tool-call formats don't bleed across
providerSelect.addEventListener('change', () => {
  history.anthropic = [];
  history.openai = [];
  history.gemini = [];
});

// ── Tool Definitions (provider-specific formats) ──────────────────────────────

const SYSTEM_PROMPT = `You help users query and understand energy data using SQL. Always call get_schema before writing SQL so you use correct table and column names.
When you write SQL, show it clearly. After running a query, explain the results in plain language.
Only use SELECT queries. Never modify data.`;

const TOOL_DEFS = {
  get_schema: {
    description: 'Returns the full database schema including all tables, columns, types, and relationships. Always call this before writing SQL.',
    parameters: { type: 'object', properties: {} },
  },
  run_sql: {
    description: 'Executes a read-only SQL SELECT query against the Postgres database and returns the results.',
    parameters: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'A valid PostgreSQL SELECT query' } },
      required: ['sql'],
    },
  },
};

// ── Tool Executor ─────────────────────────────────────────────────────────────

async function executeTool(name, input, bubble) {
  if (name === 'get_schema') {
    bubble.querySelector('#thinking-text') && (bubble.querySelector('#thinking-text').textContent = 'Fetching schema…');
    return JSON.stringify(await getSchema());
  }
  if (name === 'run_sql') {
    bubble.querySelector('#thinking-text') && (bubble.querySelector('#thinking-text').textContent = 'Running query…');
    const result = await runSql(input.sql);
    appendToBubble(bubble, `
      <div class="flex items-start gap-3 mt-2">
        <div class="w-6 h-6 shrink-0"></div>
        <div class="min-w-0 flex-1">${sqlBlock(input.sql)}${resultsTable(result.columns, result.rows)}</div>
      </div>`);
    bubble.insertAdjacentHTML('beforeend',
      `<div class="flex items-start gap-3 mt-2"><div class="w-6 h-6 shrink-0"></div><div class="text-sm text-white/40 italic" id="thinking-text">Interpreting results…</div></div>`);
    return JSON.stringify(result);
  }
  throw new Error(`Unknown tool: ${name}`);
}

// ── Provider: Anthropic ───────────────────────────────────────────────────────

async function askAnthropic(messages, bubble, apiKey) {
  const tools = Object.entries(TOOL_DEFS).map(([name, def]) => ({
    name, description: def.description, input_schema: def.parameters,
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, system: SYSTEM_PROMPT, tools, messages }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Anthropic API error'); }

  const msg = await res.json();
  messages.push({ role: 'assistant', content: msg.content });

  if (msg.stop_reason === 'tool_use') {
    const toolResults = [];
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;
      try {
        const content = await executeTool(block.name, block.input, bubble);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
      } catch (err) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: err.message, is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });
    return askAnthropic(messages, bubble, apiKey);
  }

  return msg.content.find(b => b.type === 'text')?.text || '';
}

// ── Provider: OpenAI ──────────────────────────────────────────────────────────

async function askOpenAI(messages, bubble, apiKey, { baseUrl = 'https://api.openai.com/v1', model = 'gpt-4o' } = {}) {
  const tools = Object.entries(TOOL_DEFS).map(([name, def]) => ({
    type: 'function', function: { name, description: def.description, parameters: def.parameters },
  }));

  const oaiMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, tools, messages: oaiMessages }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'OpenAI API error'); }

  const data = await res.json();
  const choice = data.choices[0].message;
  oaiMessages.push(choice);
  messages.push(choice);

  if (choice.tool_calls?.length) {
    for (const tc of choice.tool_calls) {
      let content;
      try {
        content = await executeTool(tc.function.name, JSON.parse(tc.function.arguments), bubble);
      } catch (err) {
        content = `Error: ${err.message}`;
      }
      oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content });
      messages.push({ role: 'tool', tool_call_id: tc.id, content });
    }
    return askOpenAI(messages, bubble, apiKey, { baseUrl, model });
  }

  return choice.content || '';
}

// ── Provider: Gemini ──────────────────────────────────────────────────────────

async function askGemini(contents, bubble, apiKey) {
  const tools = [{
    function_declarations: Object.entries(TOOL_DEFS).map(([name, def]) => ({
      name, description: def.description, parameters: def.parameters,
    })),
  }];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, tools, contents }),
    }
  );
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Gemini API error'); }

  const data = await res.json();
  const parts = data.candidates[0].content.parts;
  contents.push({ role: 'model', parts });

  const functionCalls = parts.filter(p => p.functionCall);
  if (functionCalls.length) {
    const responseParts = [];
    for (const part of functionCalls) {
      let response;
      try {
        const result = await executeTool(part.functionCall.name, part.functionCall.args, bubble);
        response = { name: part.functionCall.name, response: { result } };
      } catch (err) {
        response = { name: part.functionCall.name, response: { error: err.message } };
      }
      responseParts.push({ functionResponse: response });
    }
    contents.push({ role: 'user', parts: responseParts });
    return askGemini(contents, bubble, apiKey);
  }

  return parts.find(p => p.text)?.text || '';
}

// ── Main Handler ──────────────────────────────────────────────────────────────

async function processQuery(e) {
  e.preventDefault();

  const query = userInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  const provider = providerSelect.value;

  if (!query) return;
  if (!apiKey) {
    alert('Please enter your API key in the sidebar.');
    return;
  }

  localStorage.setItem('llm_api_key', apiKey);
  userInput.value = '';
  userInput.disabled = true;

  userBubble(query);
  const bubble = thinkingBubble();

  try {
    let answer;
    const hist = historyFor(provider);

    if (provider === 'anthropic') {
      hist.push({ role: 'user', content: query });
      answer = await askAnthropic(hist, bubble, apiKey);
    } else if (provider === 'gemini') {
      hist.push({ role: 'user', parts: [{ text: query }] });
      answer = await askGemini(hist, bubble, apiKey);
    } else {
      hist.push({ role: 'user', content: query });
      const opts =
        provider === 'kimi'        ? { baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2-0711-preview' } :
        provider === 'groq'        ? { baseUrl: 'https://api.groq.com/openai/v1', model: 'moonshotai/kimi-k2-instruct-0905' } :
        provider === 'groq-llama'  ? { baseUrl: 'https://api.groq.com/openai/v1', model: 'meta-llama/llama-4-scout-17b-16e-instruct' } :
                                     {};
      answer = await askOpenAI(hist, bubble, apiKey, opts);
    }

    bubble.querySelectorAll('#thinking-text').forEach(el => el.closest('div')?.remove());
    bubble.insertAdjacentHTML('beforeend', `
      <div class="flex items-start gap-3 mt-2">
        <div class="w-6 h-6 shrink-0"></div>
        <div class="min-w-0 flex-1">${assistantText(answer)}</div>
      </div>`);
  } catch (err) {
    bubble.querySelectorAll('#thinking-text').forEach(el => el.closest('div')?.remove());
    bubble.insertAdjacentHTML('beforeend', `
      <div class="flex items-start gap-3 mt-2">
        <div class="w-6 h-6 shrink-0"></div>
        <div>${errorBubble(err.message)}</div>
      </div>`);
  } finally {
    userInput.disabled = false;
    userInput.focus();
    chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: 'smooth' });
  }
}

inputForm.addEventListener('submit', processQuery);
