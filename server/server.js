import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend
app.use(express.static(path.join(__dirname, '..')));

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

// Dynamically introspect the connected Postgres database
async function introspectSchema(pool) {
  // Get all columns across all user tables
  const { rows: columns } = await pool.query(`
    SELECT
      t.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      pg_catalog.col_description(
        (quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass,
        c.ordinal_position
      ) AS column_comment
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name, c.ordinal_position
  `);

  // Get foreign key relationships
  const { rows: fkeys } = await pool.query(`
    SELECT
      kcu.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `);

  // Sample a few rows per table so the LLM understands the data shape
  const tableNames = [...new Set(columns.map(r => r.table_name))];
  const samples = {};
  for (const table of tableNames) {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${pg.escapeIdentifier(table)} LIMIT 3`);
      samples[table] = rows;
    } catch {
      samples[table] = [];
    }
  }

  // Build structured schema
  const tables = {};
  for (const row of columns) {
    if (!tables[row.table_name]) tables[row.table_name] = { name: row.table_name, columns: [] };
    tables[row.table_name].columns.push({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
      ...(row.column_comment && { description: row.column_comment }),
    });
  }

  return {
    tables: Object.values(tables).map(t => ({
      ...t,
      sample_rows: samples[t.name] || [],
    })),
    relationships: fkeys.map(fk => ({
      from: `${fk.from_table}.${fk.from_column}`,
      to: `${fk.to_table}.${fk.to_column}`,
    })),
  };
}

// Schema is introspected live from the database
app.get('/schema', async (req, res) => {
  try {
    const pool = getPool(req);
    const schema = await introspectSchema(pool);
    res.json(schema);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
