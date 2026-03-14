import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(path.join(__dirname, 'schema.json'), 'utf-8'));

const app = express();
app.use(cors());
app.use(express.json());

const defaultPool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const poolCache = {};

function getPool(req) {
  const url = req.headers['x-database-url'] || process.env.DATABASE_URL;
  if (!url) throw new Error('No database URL configured. Set one in the app sidebar or DATABASE_URL env var.');
  if (!poolCache[url]) {
    poolCache[url] = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  }
  return poolCache[url];
}

// Return the documented schema so the LLM has full context
app.get('/schema', (req, res) => res.json(schema));

// Execute a read-only SQL query
app.post('/query', async (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'Missing sql field' });

  const normalized = sql.trim().toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    return res.status(403).json({ error: 'Only SELECT queries are allowed' });
  }

  try {
    const pool = getPool(req);
    const result = await pool.query(sql);
    res.json({ columns: result.fields.map(f => f.name), rows: result.rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
