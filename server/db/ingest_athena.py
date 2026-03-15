"""
Ingestion script — processes CSV files and uploads to S3 as Parquet,
then registers tables in AWS Glue so they can be queried via Athena.

Required env vars:
    S3_BUCKET       e.g. my-nerdata-bucket
    AWS_REGION      e.g. eu-west-1
    AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY

Optional:
    S3_PREFIX       prefix inside the bucket (default: nerdata/)
    GLUE_DATABASE   Glue database name (default: nerdata)

Usage:
    pip install polars boto3 pyarrow
    S3_BUCKET=my-bucket AWS_REGION=eu-west-1 python server/db/ingest_athena.py
"""

import os
import io
import glob
from pathlib import Path
from collections import defaultdict
import boto3
import polars as pl

S3_BUCKET     = os.environ["S3_BUCKET"]
S3_PREFIX     = os.environ.get("S3_PREFIX", "nerdata/")
AWS_REGION    = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION", "eu-west-1")
GLUE_DATABASE = os.environ.get("GLUE_DATABASE", "nerdata")
DATA_DIR      = Path(__file__).resolve().parents[2] / "data"

s3   = boto3.client("s3",   region_name=AWS_REGION)
glue = boto3.client("glue", region_name=AWS_REGION)

# ── Helpers ───────────────────────────────────────────────────────────────────

def zone_from_filename(filepath):
    return Path(filepath).name.split("-")[0]

def to_hour(ts_col):
    return (ts_col.str.slice(0, 13) + ":00")

def upload_parquet(df: pl.DataFrame, s3_key: str):
    buf = io.BytesIO()
    df.write_parquet(buf)
    buf.seek(0)
    s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=buf.getvalue())
    print(f"    → s3://{S3_BUCKET}/{s3_key} ({len(df):,} rows)")

def ensure_glue_database():
    try:
        glue.get_database(Name=GLUE_DATABASE)
    except glue.exceptions.EntityNotFoundException:
        glue.create_database(DatabaseInput={"Name": GLUE_DATABASE})
        print(f"Created Glue database: {GLUE_DATABASE}")

def register_glue_table(table_name: str, s3_location: str, columns: list[dict]):
    """Create or update a Glue table pointing at the S3 Parquet location."""
    storage = {
        "Location": s3_location,
        "InputFormat":  "org.apache.hadoop.mapred.TextInputFormat",
        "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        "SerdeInfo": {
            "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
        },
    }
    table_input = {
        "Name": table_name,
        "StorageDescriptor": {**storage, "Columns": columns},
        "TableType": "EXTERNAL_TABLE",
        "Parameters": {"classification": "parquet", "compressionType": "none"},
    }
    try:
        glue.get_table(DatabaseName=GLUE_DATABASE, Name=table_name)
        glue.update_table(DatabaseName=GLUE_DATABASE, TableInput=table_input)
        print(f"  Updated Glue table: {GLUE_DATABASE}.{table_name}")
    except glue.exceptions.EntityNotFoundException:
        glue.create_table(DatabaseName=GLUE_DATABASE, TableInput=table_input)
        print(f"  Created Glue table: {GLUE_DATABASE}.{table_name}")

def col(name, type_):
    return {"Name": name, "Type": type_}

# ── Loaders ───────────────────────────────────────────────────────────────────

def load_spot_prices():
    frames = []
    for filepath in sorted(glob.glob(str(DATA_DIR / "spot-price" / "*.csv"))):
        zone = zone_from_filename(filepath)
        df = pl.read_csv(filepath, new_columns=["ts", "price"]).with_columns(
            pl.lit(zone).alias("zone")
        ).select(["zone", "ts", "price"])
        frames.append(df)
    combined = pl.concat(frames).rename({"price": "price_eur_mwh"})
    upload_parquet(combined, f"{S3_PREFIX}spot_prices/data.parquet")
    register_glue_table("spot_prices", f"s3://{S3_BUCKET}/{S3_PREFIX}spot_prices/", [
        col("zone",          "string"),
        col("ts",            "string"),
        col("price_eur_mwh", "double"),
    ])

def load_generation():
    frames = []
    for filepath in sorted(glob.glob(str(DATA_DIR / "generation" / "*.csv"))):
        zone = zone_from_filename(filepath)
        df = (
            pl.read_csv(filepath, new_columns=["source", "ts", "value"])
            .with_columns([
                pl.lit(zone).alias("zone"),
                to_hour(pl.col("ts")).alias("hour"),
            ])
            .group_by(["zone", "hour", "source"])
            .agg(pl.col("value").mean().alias("value_mw"))
            .rename({"hour": "ts"})
        )
        frames.append(df)
    combined = pl.concat(frames).select(["zone", "ts", "source", "value_mw"])
    upload_parquet(combined, f"{S3_PREFIX}generation/data.parquet")
    register_glue_table("generation", f"s3://{S3_BUCKET}/{S3_PREFIX}generation/", [
        col("zone",     "string"),
        col("ts",       "string"),
        col("source",   "string"),
        col("value_mw", "double"),
    ])

def load_total_load():
    frames = []
    for filepath in sorted(glob.glob(str(DATA_DIR / "total-load" / "*.csv"))):
        zone = zone_from_filename(filepath)
        df = (
            pl.read_csv(filepath, new_columns=["ts", "value"])
            .with_columns([
                pl.lit(zone).alias("zone"),
                to_hour(pl.col("ts")).alias("hour"),
            ])
            .group_by(["zone", "hour"])
            .agg(pl.col("value").mean().alias("value_mw"))
            .rename({"hour": "ts"})
        )
        frames.append(df)
    combined = pl.concat(frames).select(["zone", "ts", "value_mw"])
    upload_parquet(combined, f"{S3_PREFIX}total_load/data.parquet")
    register_glue_table("total_load", f"s3://{S3_BUCKET}/{S3_PREFIX}total_load/", [
        col("zone",     "string"),
        col("ts",       "string"),
        col("value_mw", "double"),
    ])

def load_flows():
    frames = []
    for filepath in sorted(glob.glob(str(DATA_DIR / "flows" / "*.csv"))):
        df = (
            pl.read_csv(filepath, new_columns=["zone_pair", "ts", "value"])
            .with_columns([
                pl.col("zone_pair").str.split("->").list.get(0).alias("from_zone"),
                pl.col("zone_pair").str.split("->").list.get(1).alias("to_zone"),
                pl.col("ts").str.slice(0, 10).alias("day"),
            ])
            .group_by(["from_zone", "to_zone", "day"])
            .agg(pl.col("value").mean().alias("value_mw"))
            .rename({"day": "ts"})
        )
        frames.append(df)
    combined = pl.concat(frames).select(["from_zone", "to_zone", "ts", "value_mw"])
    upload_parquet(combined, f"{S3_PREFIX}physical_flows/data.parquet")
    register_glue_table("physical_flows", f"s3://{S3_BUCKET}/{S3_PREFIX}physical_flows/", [
        col("from_zone", "string"),
        col("to_zone",   "string"),
        col("ts",        "string"),
        col("value_mw",  "double"),
    ])

def load_weather():
    frames = []
    for filepath in sorted(glob.glob(str(DATA_DIR / "weather" / "*.csv"))):
        zone = zone_from_filename(filepath)
        df = pl.read_csv(filepath, skip_rows=3, new_columns=[
            "ts", "temperature_2m", "wind_speed_10m", "wind_speed_100m",
            "relative_humidity", "cloud_cover", "wind_direction_10m",
            "wind_direction_100m", "precipitation",
        ]).with_columns(pl.lit(zone).alias("zone")).select([
            "zone", "ts", "temperature_2m", "wind_speed_10m", "wind_speed_100m",
            "relative_humidity", "cloud_cover", "wind_direction_10m",
            "wind_direction_100m", "precipitation",
        ])
        frames.append(df)
    combined = pl.concat(frames)
    upload_parquet(combined, f"{S3_PREFIX}weather/data.parquet")
    register_glue_table("weather", f"s3://{S3_BUCKET}/{S3_PREFIX}weather/", [
        col("zone",                "string"),
        col("ts",                  "string"),
        col("temperature_2m",      "double"),
        col("wind_speed_10m",      "double"),
        col("wind_speed_100m",     "double"),
        col("relative_humidity",   "int"),
        col("cloud_cover",         "int"),
        col("wind_direction_10m",  "int"),
        col("wind_direction_100m", "int"),
        col("precipitation",       "double"),
    ])

def load_zones():
    zones = [
        ("AT",       "Austria"),
        ("BE",       "Belgium"),
        ("CH",       "Switzerland"),
        ("CZ",       "Czech Republic"),
        ("DE",       "Germany"),
        ("DK1",      "Denmark West"),
        ("DK2",      "Denmark East"),
        ("FR",       "France"),
        ("NL",       "Netherlands"),
        ("NO2",      "Norway South"),
        ("PL",       "Poland"),
        ("SE4",      "Sweden South"),
        ("DK",       "Denmark"),
        ("ES",       "Spain"),
        ("GB",       "Great Britain"),
        ("HU",       "Hungary"),
        ("IT",       "Italy"),
        ("IT-NORTH", "Italy North"),
        ("LT",       "Lithuania"),
        ("NO1",      "Norway South-East"),
        ("NO5",      "Norway West"),
        ("SE3",      "Sweden Central"),
        ("SI",       "Slovenia"),
        ("SK",       "Slovakia"),
        ("UA",       "Ukraine"),
    ]
    df = pl.DataFrame({"zone_code": [z[0] for z in zones], "country_name": [z[1] for z in zones]})
    upload_parquet(df, f"{S3_PREFIX}zones/data.parquet")
    register_glue_table("zones", f"s3://{S3_BUCKET}/{S3_PREFIX}zones/", [
        col("zone_code",    "string"),
        col("country_name", "string"),
    ])

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Ensuring Glue database...")
    ensure_glue_database()

    print("\nUploading zones...")
    load_zones()

    print("\nUploading spot prices...")
    load_spot_prices()

    print("\nUploading generation (hourly averages)...")
    load_generation()

    print("\nUploading total load (hourly averages)...")
    load_total_load()

    print("\nUploading physical flows (daily averages)...")
    load_flows()

    print("\nUploading weather...")
    load_weather()

    print(f"\nDone. Query in Athena using database: {GLUE_DATABASE}")
    print(f"Tables: spot_prices, generation, total_load, physical_flows, weather")

if __name__ == "__main__":
    main()
