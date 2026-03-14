---
name: Project Idea - Text-to-SQL Chrome Extension
description: Core concept, architecture, and value proposition for the auhack2026 project
type: project
---

Natural language to SQL Chrome extension targeting cloud data warehouses (Amazon Athena, BigQuery, Azure Synapse). Lets non-technical stakeholders query databases by typing plain English instead of SQL.

**Flow:**
1. Chrome extension injects a prompt input into the cloud query editor UI
2. User types natural language (e.g. "show me sales by region last quarter")
3. MCP server provides database schema context (tables, columns, types, relationships)
4. LLM generates correct SQL using that schema context
5. Extension injects SQL into the query editor (optionally auto-runs it)

**Why:** Democratizes data access for stakeholders who need data but can't write SQL well.

**Key design decisions:**
- MCP server holds schema context — this is what makes generated SQL accurate vs. hallucinated
- SELECT-only by default (non-destructive)
- Show generated SQL to user before running (educational + trust)
- Platform-agnostic: SQL dialect can be a setting; extension targets query editor DOM per platform
- For hackathon demo: target one platform (Athena or BigQuery), hardcode a sample schema

**How to apply:** When suggesting architecture or features, keep non-technical stakeholders as the primary user. Favor simplicity and trust (show SQL before executing). The MCP schema tool is the core differentiator.
