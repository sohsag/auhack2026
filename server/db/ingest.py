"""
Ingestion script — loads all CSV files from /data into Postgres.

Usage:
    source .venv/bin/activate
    DATABASE_URL=<connection_string> python server/db/ingest.py
"""

import os
import glob
from pathlib import Path
import polars as pl
import psycopg2
from psycopg2.extras import execute_values

DATABASE_URL = os.environ["DATABASE_URL"]
DATA_DIR = Path(__file__).resolve().parents[2] / "data"
BATCH_SIZE = 10000


def get_conn():
    return psycopg2.connect(DATABASE_URL, sslmode="require")


def zone_from_filename(filepath):
    return Path(filepath).name.split("-")[0]


def upsert(conn, query, rows):
    with conn.cursor() as cur:
        execute_values(cur, query, rows, page_size=BATCH_SIZE)
    conn.commit()


# ── Schema ───────────────────────────────────────────────────────────────────

def apply_schema(conn):
    schema_path = Path(__file__).parent / "schema.sql"
    with conn.cursor() as cur:
        cur.execute(schema_path.read_text())
    conn.commit()
    print("Schema applied.")


# ── Loaders ──────────────────────────────────────────────────────────────────

def load_spot_prices(conn, filepath):
    zone = zone_from_filename(filepath)
    df = pl.read_csv(filepath, new_columns=["ts", "price"])
    rows = [(zone, ts, price) for ts, price in df.iter_rows()]
    upsert(conn, "INSERT INTO spot_prices (zone, ts, price_eur_mwh) VALUES %s ON CONFLICT DO NOTHING", rows)


def load_generation(conn, filepath):
    zone = zone_from_filename(filepath)
    df = (
        pl.read_csv(filepath, new_columns=["source", "ts", "value"])
        .with_columns((pl.col("ts").str.slice(0, 13) + ":00").alias("hour"))
        .group_by(["hour", "source"])
        .agg(pl.col("value").mean().alias("value_mw"))
        .sort("hour")
    )
    rows = [(zone, hour, source, value) for hour, source, value in df.iter_rows()]
    upsert(conn, "INSERT INTO generation (zone, ts, source, value_mw) VALUES %s ON CONFLICT DO NOTHING", rows)


def load_total_load(conn, filepath):
    zone = zone_from_filename(filepath)
    df = (
        pl.read_csv(filepath, new_columns=["ts", "value"])
        .with_columns((pl.col("ts").str.slice(0, 13) + ":00").alias("hour"))
        .group_by("hour")
        .agg(pl.col("value").mean().alias("value_mw"))
        .sort("hour")
    )
    rows = [(zone, hour, value) for hour, value in df.iter_rows()]
    upsert(conn, "INSERT INTO total_load (zone, ts, value_mw) VALUES %s ON CONFLICT DO NOTHING", rows)


def load_flows(conn, filepath):
    """Downsample hourly flows to daily averages to stay within DB size limits."""
    df = (
        pl.read_csv(filepath, new_columns=["zone_pair", "ts", "value"])
        .with_columns([
            pl.col("zone_pair").str.split("->").list.get(0).alias("from_zone"),
            pl.col("zone_pair").str.split("->").list.get(1).alias("to_zone"),
            pl.col("ts").str.slice(0, 10).alias("day"),  # "2024-01-01"
        ])
        .group_by(["from_zone", "to_zone", "day"])
        .agg(pl.col("value").mean().alias("value_mw"))
        .sort("day")
    )
    rows = [(from_z, to_z, day, val) for from_z, to_z, day, val in df.iter_rows()]
    upsert(conn, "INSERT INTO physical_flows (from_zone, to_zone, ts, value_mw) VALUES %s ON CONFLICT DO NOTHING", rows)


def load_weather(conn, filepath):
    zone = zone_from_filename(filepath)
    # Row 0: lat/lon metadata, row 1: blank, row 2: blank, row 3: column headers, row 4+: data
    df = pl.read_csv(filepath, skip_rows=3, new_columns=[
        "ts", "temperature_2m", "wind_speed_10m", "wind_speed_100m",
        "relative_humidity", "cloud_cover", "wind_direction_10m", "wind_direction_100m", "precipitation",
    ])
    rows = [
        (zone, ts, temp, ws10, ws100, int(rh), int(cc), int(wd10), int(wd100), precip)
        for ts, temp, ws10, ws100, rh, cc, wd10, wd100, precip in df.iter_rows()
    ]
    upsert(conn, """
        INSERT INTO weather
            (zone, ts, temperature_2m, wind_speed_10m, wind_speed_100m,
             relative_humidity, cloud_cover, wind_direction_10m, wind_direction_100m, precipitation)
        VALUES %s ON CONFLICT DO NOTHING""", rows)


# ── Main ─────────────────────────────────────────────────────────────────────

def process_dir(conn, folder, loader):
    files = sorted(glob.glob(str(DATA_DIR / folder / "*.csv")))
    for filepath in files:
        print(f"  {Path(filepath).name}")
        loader(conn, filepath)


def main():
    conn = get_conn()
    try:
        print("Applying schema...")
        apply_schema(conn)

        print("\nLoading spot prices...")
        process_dir(conn, "spot-price", load_spot_prices)

        print("\nLoading generation (hourly averages)...")
        process_dir(conn, "generation", load_generation)

        print("\nLoading total load (hourly averages)...")
        process_dir(conn, "total-load", load_total_load)

        print("\nLoading physical flows...")
        process_dir(conn, "flows", load_flows)

        print("\nLoading weather...")
        process_dir(conn, "weather", load_weather)

        print("\nDone.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
