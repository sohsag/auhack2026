# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Natural language to SQL Chrome extension for cloud data warehouses (Amazon Athena, BigQuery, Azure Synapse). Users type a plain English question; the MCP server provides schema context; an LLM generates SQL; the extension injects it into the query editor.

## Tech Stack

- **MCP Server**: Node.js + Express + `@modelcontextprotocol/sdk` (SSE transport for browser clients)
- **Frontend/Extension**: Vanilla HTML/CSS/JS (no build step)
- **LLM**: OpenAI or Anthropic API called directly from the browser

## Structure

```
server/       MCP server — exposes get_schema and search_schema tools
  server.js   Express app wrapping the MCP server via SSE transport
  schema.json Sample database schema (tables, columns, relationships)
```

Chrome extension and frontend UI to be added.

## Commands

```bash
# Install and run the MCP server
cd server && npm install && npm start
# Server runs on http://localhost:3000
# Health check: GET /health
```

## Architecture Notes

- The MCP server exposes two tools: `get_schema` (full schema dump) and `search_schema` (keyword filter). The LLM calls these before generating SQL so column/table names are accurate.
- SSE transport (`GET /sse`) is used so browser-based clients (extension, HTML frontend) can connect without a native MCP client.
- `schema.json` is the only thing that needs to change to target a different database — swap it out per deployment.
