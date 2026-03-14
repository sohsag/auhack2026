import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const schema = JSON.parse(readFileSync('./schema.json', 'utf-8'));

// --- MCP Server ---

const mcpServer = new Server(
  { name: 'sql-schema-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_schema',
      description:
        'Returns the full database schema: all tables, columns, data types, descriptions, and foreign key relationships. Call this before generating any SQL.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'search_schema',
      description:
        'Search for tables or columns by keyword. Useful when the schema is large and you need to find relevant tables quickly.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword to search for in table/column names and descriptions',
          },
        },
        required: ['query'],
      },
    },
  ],
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'get_schema') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(schema, null, 2),
        },
      ],
    };
  }

  if (name === 'search_schema') {
    const q = args.query.toLowerCase();
    const matches = schema.tables
      .map((table) => {
        const tableMatches =
          table.name.toLowerCase().includes(q) ||
          table.description.toLowerCase().includes(q);

        const matchingColumns = table.columns.filter(
          (col) =>
            col.name.toLowerCase().includes(q) ||
            col.description.toLowerCase().includes(q)
        );

        if (tableMatches || matchingColumns.length > 0) {
          return {
            table: table.name,
            description: table.description,
            columns: tableMatches ? table.columns : matchingColumns,
          };
        }
        return null;
      })
      .filter(Boolean);

    return {
      content: [
        {
          type: 'text',
          text: matches.length
            ? JSON.stringify(matches, null, 2)
            : `No tables or columns matching "${args.query}" found.`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// --- Express HTTP wrapper (for browser/extension clients via SSE) ---

const app = express();
app.use(cors());

const transports = {};

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;
  await mcpServer.connect(transport);

  res.on('close', () => {
    delete transports[transport.sessionId];
  });
});

app.post('/messages', express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    return res.status(404).json({ error: 'Session not found' });
  }
  await transport.handlePostMessage(req, res);
});

// Health check — useful for verifying the server is up
app.get('/health', (_, res) => res.json({ status: 'ok', database: schema.database }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP server running on http://localhost:${PORT}`);
  console.log(`  SSE endpoint:    GET  /sse`);
  console.log(`  Message handler: POST /messages`);
  console.log(`  Health check:    GET  /health`);
});
