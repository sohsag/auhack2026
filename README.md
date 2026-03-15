# Nerdata

Talk to your database in plain English. Nerdata connects to any PostgreSQL database, introspects the schema automatically, and lets you ask questions — no SQL needed.

## What it is

**Nerdata** is a chat UI that acts as a natural language interface to Postgres. You paste a connection string, ask a question, and the LLM figures out the schema, writes the SQL, runs it, and explains the results. It works with any database — not just the one it was built with.

## How it works

1. You connect a Postgres database via connection string
2. When you ask a question, the LLM calls `get_schema` — the server introspects `information_schema` live and returns all tables, columns, types, relationships, and sample rows
3. The LLM uses that to write a SQL query, which runs against your database
4. Results come back as a table in the chat, with a plain-English explanation
5. You can ask follow-up questions and ask to plot the data as a chart — the LLM remembers the conversation

## Stack

- `index.html` + `app.js` — chat UI, runs entirely in the browser, calls LLM APIs directly
- `server/server.js` — lightweight Express server that proxies queries to Postgres and serves live schema
- LLM providers: Anthropic (Claude), OpenAI (GPT-4o), Google (Gemini), Moonshot (Kimi K2), Groq

## Running it

**Start:**
```bash
cd server
npm install
node server.js
```

Then open `http://localhost:3000` in your browser.

**Configure in the sidebar:**
- Pick your LLM provider and paste your API key
- Paste a PostgreSQL connection string
- Server URL defaults to `http://localhost:3000`

The server also reads `DATABASE_URL` from the environment if you prefer not to enter it in the UI.

## Dataset

The repo includes a European energy grid dataset (`data/`) covering 2024 — spot prices, electricity generation by source, total load, cross-border physical flows, and weather across 12 bidding zones.

To ingest it into your own Postgres:
```bash
cd server/db
pip install polars psycopg2-binary
DATABASE_URL=postgresql://... python ingest.py
```
