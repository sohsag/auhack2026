/**
 * Ingestion script — loads all CSV files from /data into Postgres.
 *
 * Usage:
 *   DATABASE_URL=<connection_string> node server/db/ingest.js
 *
 * Processes: spot-price, generation, total-load, physical-flows, weather
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const BATCH_SIZE = 2000;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Schema applied.');
}

function streamLines(filePath) {
  return readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
}

function zoneFromFilename(filename) {
  // e.g. "DE-spot-price.csv" → "DE", "DK1-generation.csv" → "DK1"
  return path.basename(filename).split('-')[0];
}

// ── Loaders ─────────────────────────────────────────────────────────────────

async function loadSpotPrices(filePath) {
  const zone = zoneFromFilename(filePath);
  const rl = streamLines(filePath);
  let batch = [];
  let header = true;

  const upsert = `
    INSERT INTO spot_prices (zone, ts, price_eur_mwh)
    SELECT $1::varchar, unnest($2::timestamptz[]), unnest($3::numeric[])
    ON CONFLICT DO NOTHING`;

  for await (const line of rl) {
    if (header) { header = false; continue; }
    const [ts, value] = line.split(',');
    if (!ts || !value) continue;
    batch.push([ts.trim(), parseFloat(value)]);
    if (batch.length >= BATCH_SIZE) {
      await pool.query(upsert, [zone, batch.map(r => r[0]), batch.map(r => r[1])]);
      batch = [];
    }
  }
  await pool.query(upsert, [zone, batch.map(r => r[0]), batch.map(r => r[1])]);
}

/** Truncate a "2024-01-01T00:15" timestamp string to the hour → "2024-01-01T00:00" */
function toHour(ts) {
  return ts.slice(0, 13) + ':00';
}

async function loadGeneration(filePath) {
  // Downsample 15-min data to hourly averages to stay within DB size limits.
  // Accumulate readings per (hourBucket, source), flush when the hour changes.
  const zone = zoneFromFilename(filePath);
  const rl = streamLines(filePath);
  let header = true;

  // hourly accumulators: key = "HH:MM|SOURCE" → { sum, count }
  let currentHour = null;
  const acc = {};

  const upsert = `
    INSERT INTO generation (zone, ts, source, value_mw)
    SELECT $1::varchar, unnest($2::timestamptz[]), unnest($3::generation_source[]), unnest($4::numeric[])
    ON CONFLICT DO NOTHING`;

  async function flushAcc(hour) {
    const tss = [], sources = [], values = [];
    for (const [src, { sum, count }] of Object.entries(acc)) {
      tss.push(hour);
      sources.push(src);
      values.push(sum / count);
    }
    if (tss.length > 0) {
      await pool.query(upsert, [zone, tss, sources, values]);
    }
    for (const k of Object.keys(acc)) delete acc[k];
  }

  for await (const line of rl) {
    if (header) { header = false; continue; }
    const [source, ts, value] = line.split(',');
    if (!source || !ts || !value) continue;
    const hour = toHour(ts.trim());
    const src = source.trim();
    if (currentHour && hour !== currentHour) {
      await flushAcc(currentHour);
    }
    currentHour = hour;
    if (!acc[src]) acc[src] = { sum: 0, count: 0 };
    acc[src].sum += parseFloat(value);
    acc[src].count += 1;
  }
  if (currentHour) await flushAcc(currentHour);
}

async function loadTotalLoad(filePath) {
  // Also 15-min resolution — downsample to hourly averages.
  const zone = zoneFromFilename(filePath);
  const rl = streamLines(filePath);
  let header = true;
  let currentHour = null;
  let sum = 0, count = 0;

  const upsert = `
    INSERT INTO total_load (zone, ts, value_mw)
    SELECT $1::varchar, unnest($2::timestamptz[]), unnest($3::numeric[])
    ON CONFLICT DO NOTHING`;

  async function flushHour(hour) {
    if (count > 0) {
      await pool.query(upsert, [zone, [hour], [sum / count]]);
    }
    sum = 0; count = 0;
  }

  for await (const line of rl) {
    if (header) { header = false; continue; }
    const [ts, value] = line.split(',');
    if (!ts || !value) continue;
    const hour = toHour(ts.trim());
    if (currentHour && hour !== currentHour) {
      await flushHour(currentHour);
    }
    currentHour = hour;
    sum += parseFloat(value);
    count += 1;
  }
  if (currentHour) await flushHour(currentHour);
}

async function loadFlows(filePath) {
  // zone column is "FR->DE" format
  const rl = streamLines(filePath);
  let batch = [];
  let header = true;

  const upsert = `
    INSERT INTO physical_flows (from_zone, to_zone, ts, value_mw)
    SELECT unnest($1::varchar[]), unnest($2::varchar[]), unnest($3::timestamptz[]), unnest($4::numeric[])
    ON CONFLICT DO NOTHING`;

  for await (const line of rl) {
    if (header) { header = false; continue; }
    const [zone, ts, value] = line.split(',');
    if (!zone || !ts || !value) continue;
    const [from_zone, to_zone] = zone.split('->');
    batch.push([from_zone.trim(), to_zone.trim(), ts.trim(), parseFloat(value)]);
    if (batch.length >= BATCH_SIZE) {
      await pool.query(upsert, [batch.map(r => r[0]), batch.map(r => r[1]), batch.map(r => r[2]), batch.map(r => r[3])]);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await pool.query(upsert, [batch.map(r => r[0]), batch.map(r => r[1]), batch.map(r => r[2]), batch.map(r => r[3])]);
  }
}

async function loadWeather(filePath) {
  // Weather CSVs have a 3-line header: metadata, blank, column names
  const zone = zoneFromFilename(filePath);
  const rl = streamLines(filePath);
  let batch = [];
  let lineNum = 0;

  const upsert = `
    INSERT INTO weather (zone, ts, temperature_2m, wind_speed_10m, wind_speed_100m, relative_humidity, cloud_cover, wind_direction_10m, wind_direction_100m, precipitation)
    SELECT $1::varchar, unnest($2::timestamptz[]), unnest($3::numeric[]), unnest($4::numeric[]), unnest($5::numeric[]), unnest($6::smallint[]), unnest($7::smallint[]), unnest($8::smallint[]), unnest($9::smallint[]), unnest($10::numeric[])
    ON CONFLICT DO NOTHING`;

  for await (const line of rl) {
    lineNum++;
    if (lineNum <= 4) continue; // skip 3-row metadata header + column header
    const parts = line.split(',');
    if (parts.length < 9) continue;
    const [ts, temp, ws10, ws100, rh, cc, wd10, wd100, precip] = parts;
    batch.push([
      ts.trim(),
      parseFloat(temp), parseFloat(ws10), parseFloat(ws100),
      parseInt(rh), parseInt(cc), parseInt(wd10), parseInt(wd100),
      parseFloat(precip),
    ]);
    if (batch.length >= BATCH_SIZE) {
      await pool.query(upsert, [zone, ...Array.from({ length: 9 }, (_, i) => batch.map(r => r[i]))]);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await pool.query(upsert, [zone, ...Array.from({ length: 9 }, (_, i) => batch.map(r => r[i]))]);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function processDir(dir, ext, loader) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(ext));
  for (const file of files) {
    const filePath = path.join(dir, file);
    console.log(`  Loading ${file}...`);
    await loader(filePath);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  console.log('Applying schema...');
  await applySchema();

  console.log('\nLoading spot prices...');
  await processDir(path.join(DATA_DIR, 'spot-price'), '.csv', loadSpotPrices);

  console.log('\nLoading generation...');
  await processDir(path.join(DATA_DIR, 'generation'), '.csv', loadGeneration);

  console.log('\nLoading total load...');
  await processDir(path.join(DATA_DIR, 'total-load'), '.csv', loadTotalLoad);

  console.log('\nLoading physical flows...');
  await processDir(path.join(DATA_DIR, 'flows'), '.csv', loadFlows);

  console.log('\nLoading weather...');
  await processDir(path.join(DATA_DIR, 'weather'), '.csv', loadWeather);

  console.log('\nDone.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
