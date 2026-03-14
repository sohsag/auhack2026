// Nerdata background service worker

import { awsRequest } from './aws.js';

const SYSTEM_PROMPT = `You are a SQL expert for AWS Athena, which uses the Trino/Presto SQL dialect.

Key Athena-specific rules:
- Use double quotes for identifiers, single quotes for strings
- Date/time: use date_trunc, date_diff, date_add, from_iso8601_timestamp — NOT DATEPART or CONVERT
- String functions: regexp_like, strpos, substr — NOT CHARINDEX or PATINDEX
- Use LIMIT not TOP
- No stored procedures, no temp tables — only SELECT queries
- Timestamps stored as strings (ISO 8601) can be cast with CAST(ts AS TIMESTAMP) or from_iso8601_timestamp(ts)
- Use APPROX_DISTINCT for large cardinality estimates

Given a database schema and a natural language question, write a single SQL SELECT query that answers the question.
Return ONLY the raw SQL query with no explanation, no markdown, no code fences. Just the SQL.`;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GENERATE_SQL') {
    generateSQL(message.prompt).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.type === 'RUN_QUERY') {
    runQuery(message.sql).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ── AWS helpers ───────────────────────────────────────────────────────────────

async function getAWSCreds() {
  const s = await chrome.storage.sync.get(['awsKeyId', 'awsSecret', 'awsRegion', 'glueDatabase', 'athenaOutput']);
  if (!s.awsKeyId || !s.awsSecret) throw new Error('AWS credentials not set. Open the Nerdata popup to configure.');
  return {
    accessKeyId:     s.awsKeyId,
    secretAccessKey: s.awsSecret,
    region:          s.awsRegion     || 'eu-west-1',
    database:        s.glueDatabase  || 'nerdata',
    outputLocation:  s.athenaOutput  || '',
  };
}

// ── Schema from Glue ──────────────────────────────────────────────────────────

async function fetchSchemaFromGlue(creds) {
  const data = await awsRequest({
    accessKeyId:     creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    region:          creds.region,
    service:         'glue',
    target:          'AWSGlue.GetTables',
    body:            { DatabaseName: creds.database },
  });

  const tables = (data.TableList || []).map(t => ({
    name: t.Name,
    columns: (t.StorageDescriptor?.Columns || []).map(c => ({ name: c.Name, type: c.Type })),
  }));

  return { database: creds.database, tables };
}

// ── Athena query execution ────────────────────────────────────────────────────

async function runQuery(sql) {
  const creds = await getAWSCreds();
  if (!creds.outputLocation) throw new Error('Athena output S3 path not set in popup.');

  // Start
  const start = await awsRequest({
    accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey,
    region: creds.region, service: 'athena',
    target: 'AmazonAthena.StartQueryExecution',
    body: {
      QueryString: sql,
      QueryExecutionContext: { Database: creds.database },
      ResultConfiguration: { OutputLocation: creds.outputLocation },
    },
  });

  const id = start.QueryExecutionId;

  // Poll
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const status = await awsRequest({
      accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey,
      region: creds.region, service: 'athena',
      target: 'AmazonAthena.GetQueryExecution',
      body: { QueryExecutionId: id },
    });
    const state = status.QueryExecution.Status.State;
    if (state === 'SUCCEEDED') break;
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(status.QueryExecution.Status.StateChangeReason || `Query ${state}`);
    }
  }

  // Results
  const results = await awsRequest({
    accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey,
    region: creds.region, service: 'athena',
    target: 'AmazonAthena.GetQueryResults',
    body: { QueryExecutionId: id },
  });

  const [headerRow, ...dataRows] = results.ResultSet.Rows;
  const columns = headerRow.Data.map(d => d.VarCharValue);
  const rows = dataRows.map(row => {
    const obj = {};
    row.Data.forEach((d, i) => { obj[columns[i]] = d.VarCharValue ?? null; });
    return obj;
  });

  return { columns, rows };
}

// ── SQL generation ────────────────────────────────────────────────────────────

async function generateSQL(prompt) {
  const settings = await chrome.storage.sync.get(['apiKey', 'provider']);
  const { apiKey, provider = 'anthropic' } = settings;
  if (!apiKey) throw new Error('No API key set. Open the Nerdata popup to configure.');

  const creds = await getAWSCreds();
  const schema = await fetchSchemaFromGlue(creds);

  const schemaText = schema.tables.map(t =>
    `Table: ${t.name}\nColumns: ${t.columns.map(c => `${c.name} (${c.type})`).join(', ')}`
  ).join('\n\n');

  const userMessage = `Athena database: ${schema.database}\n\n${schemaText}\n\nQuestion: ${prompt}`;

  if (provider === 'anthropic') return callAnthropic(apiKey, userMessage);
  if (provider === 'gemini')    return callGemini(apiKey, userMessage);
  return callOpenAI(apiKey, provider, userMessage);
}

// ── LLM callers ───────────────────────────────────────────────────────────────

async function callAnthropic(apiKey, userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Anthropic error'); }
  const data = await res.json();
  return { sql: data.content.find(b => b.type === 'text')?.text.trim() };
}

async function callOpenAI(apiKey, provider, userMessage) {
  const ENDPOINTS = {
    openai:       { url: 'https://api.openai.com/v1/chat/completions',      model: 'gpt-4o' },
    kimi:         { url: 'https://api.moonshot.ai/v1/chat/completions',      model: 'kimi-k2-0711-preview' },
    groq:         { url: 'https://api.groq.com/openai/v1/chat/completions',  model: 'moonshotai/kimi-k2-instruct-0905' },
    'groq-llama': { url: 'https://api.groq.com/openai/v1/chat/completions',  model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  };
  const { url, model } = ENDPOINTS[provider] || ENDPOINTS.openai;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'API error'); }
  const data = await res.json();
  return { sql: data.choices[0].message.content.trim() };
}

async function callGemini(apiKey, userMessage) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      }),
    }
  );
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Gemini error'); }
  const data = await res.json();
  return { sql: data.candidates[0].content.parts.find(p => p.text)?.text.trim() };
}
