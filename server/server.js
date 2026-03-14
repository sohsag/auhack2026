import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from '@aws-sdk/client-athena';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(path.join(__dirname, 'schema.json'), 'utf-8'));

const app = express();
app.use(cors());
app.use(express.json());

// ── Backend detection ─────────────────────────────────────────────────────────
// Requests can specify a backend via headers:
//   x-backend: "postgres" | "athena"  (default: postgres if x-database-url set, else athena)
//   x-database-url: postgres connection string
//   x-athena-database: Glue database name (default: nerdata)
//   x-athena-output:   S3 output path for results

// ── Postgres backend ──────────────────────────────────────────────────────────

const pgPoolCache = {};

function getPgPool(url) {
  if (!pgPoolCache[url]) {
    pgPoolCache[url] = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  }
  return pgPoolCache[url];
}

async function queryPostgres(sql, req) {
  const url = req.headers['x-database-url'] || process.env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL set.');
  const result = await getPgPool(url).query(sql);
  return {
    columns: result.fields.map(f => f.name),
    rows: result.rows,
  };
}

// ── Athena backend ────────────────────────────────────────────────────────────

function getAthenaClient(req) {
  return new AthenaClient({
    region: req.headers['x-aws-region'] || process.env.AWS_REGION || 'us-east-1',
    ...(process.env.AWS_ACCESS_KEY_ID && {
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken:    process.env.AWS_SESSION_TOKEN,
      },
    }),
  });
}

async function queryAthena(sql, req) {
  const client       = getAthenaClient(req);
  const database     = req.headers['x-athena-database'] || process.env.GLUE_DATABASE || 'nerdata';
  const outputBucket = req.headers['x-athena-output']   || process.env.OUTPUT_S3_PATH;
  if (!outputBucket) throw new Error('No OUTPUT_S3_PATH set for Athena results.');

  // Start query
  const { QueryExecutionId } = await client.send(new StartQueryExecutionCommand({
    QueryString: sql,
    QueryExecutionContext: { Database: database },
    ResultConfiguration: { OutputLocation: outputBucket },
  }));

  // Poll until complete
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const { QueryExecution } = await client.send(new GetQueryExecutionCommand({ QueryExecutionId }));
    const state = QueryExecution.Status.State;
    if (state === 'SUCCEEDED') break;
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(QueryExecution.Status.StateChangeReason || `Query ${state}`);
    }
  }

  // Fetch results
  const { ResultSet } = await client.send(new GetQueryResultsCommand({ QueryExecutionId }));
  const [headerRow, ...dataRows] = ResultSet.Rows;
  const columns = headerRow.Data.map(d => d.VarCharValue);
  const rows = dataRows.map(row => {
    const obj = {};
    row.Data.forEach((d, i) => { obj[columns[i]] = d.VarCharValue ?? null; });
    return obj;
  });

  return { columns, rows };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/schema', (_, res) => res.json(schema));

app.post('/query', async (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'Missing sql field' });

  const normalized = sql.trim().toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    return res.status(403).json({ error: 'Only SELECT queries are allowed' });
  }

  try {
    const backend = req.headers['x-backend'] || (req.headers['x-database-url'] || process.env.DATABASE_URL ? 'postgres' : 'athena');
    const result = backend === 'athena'
      ? await queryAthena(sql, req)
      : await queryPostgres(sql, req);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
