-- ============================================================
-- Energy Grid Database Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS zones (
    zone_code    VARCHAR(8)  PRIMARY KEY,
    country_name VARCHAR(64) NOT NULL
);

INSERT INTO zones (zone_code, country_name) VALUES
    ('AT',  'Austria'),
    ('BE',  'Belgium'),
    ('CH',  'Switzerland'),
    ('CZ',  'Czech Republic'),
    ('DE',  'Germany'),
    ('DK1', 'Denmark West'),
    ('DK2', 'Denmark East'),
    ('FR',  'France'),
    ('NL',  'Netherlands'),
    ('NO2', 'Norway South'),
    ('PL',  'Poland'),
    ('SE4', 'Sweden South'),
    ('DK',       'Denmark'),
    -- Neighboring zones (appear in physical flows only)
    ('ES',       'Spain'),
    ('GB',       'Great Britain'),
    ('HU',       'Hungary'),
    ('IT',       'Italy'),
    ('IT-NORTH', 'Italy North'),
    ('LT',       'Lithuania'),
    ('NO1',      'Norway South-East'),
    ('NO5',      'Norway West'),
    ('SE3',      'Sweden Central'),
    ('SI',       'Slovenia'),
    ('SK',       'Slovakia'),
    ('UA',       'Ukraine')
ON CONFLICT DO NOTHING;

-- Hourly electricity spot prices (EUR/MWh)
CREATE TABLE IF NOT EXISTS spot_prices (
    zone          VARCHAR(8)   NOT NULL REFERENCES zones(zone_code),
    ts            TIMESTAMPTZ  NOT NULL,
    price_eur_mwh NUMERIC(10,4),
    PRIMARY KEY (zone, ts)
);

-- 15-min electricity generation by source type (MW)
DO $$ BEGIN
  CREATE TYPE generation_source AS ENUM (
    'BIOMASS',
    'COAL-DERVIED GAS',
    'ENERGY-STORAGE',
    'FOSSIL-GAS',
    'GEOTHERMAL',
    'HARD-COAL',
    'HYDRO-PUMPED-STORAGE',
    'HYDRO-ROR',
    'HYDRO-WATER-RESERVOIR',
    'LIGNITE',
    'NUCLEAR',
    'OIL',
    'OTHER',
    'OTHER-RENEWABLE',
    'SOLAR',
    'WASTE',
    'WIND-OFFSHORE',
    'WIND-ONSHORE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS generation (
    zone      VARCHAR(8)        NOT NULL REFERENCES zones(zone_code),
    ts        TIMESTAMPTZ       NOT NULL,
    source    generation_source NOT NULL,
    value_mw  NUMERIC(12,4),
    PRIMARY KEY (zone, ts, source)
);

-- 15-min total electricity consumption (MW)
CREATE TABLE IF NOT EXISTS total_load (
    zone     VARCHAR(8)  NOT NULL REFERENCES zones(zone_code),
    ts       TIMESTAMPTZ NOT NULL,
    value_mw NUMERIC(12,4),
    PRIMARY KEY (zone, ts)
);

-- Hourly cross-border physical power flows (MW)
CREATE TABLE IF NOT EXISTS physical_flows (
    from_zone VARCHAR(8)  NOT NULL REFERENCES zones(zone_code),
    to_zone   VARCHAR(8)  NOT NULL REFERENCES zones(zone_code),
    ts        TIMESTAMPTZ NOT NULL,
    value_mw  NUMERIC(12,4),
    PRIMARY KEY (from_zone, to_zone, ts)
);

-- Hourly weather observations per zone (open-meteo)
CREATE TABLE IF NOT EXISTS weather (
    zone                VARCHAR(8)  NOT NULL REFERENCES zones(zone_code),
    ts                  TIMESTAMPTZ NOT NULL,
    temperature_2m      NUMERIC(5,2),   -- °C
    wind_speed_10m      NUMERIC(6,2),   -- km/h
    wind_speed_100m     NUMERIC(6,2),   -- km/h
    relative_humidity   SMALLINT,       -- %
    cloud_cover         SMALLINT,       -- %
    wind_direction_10m  SMALLINT,       -- degrees
    wind_direction_100m SMALLINT,       -- degrees
    precipitation       NUMERIC(6,2),   -- mm
    PRIMARY KEY (zone, ts)
);

CREATE INDEX IF NOT EXISTS idx_spot_prices_ts      ON spot_prices (ts);
CREATE INDEX IF NOT EXISTS idx_generation_ts       ON generation (ts);
CREATE INDEX IF NOT EXISTS idx_generation_source   ON generation (source);
CREATE INDEX IF NOT EXISTS idx_total_load_ts       ON total_load (ts);
CREATE INDEX IF NOT EXISTS idx_physical_flows_ts   ON physical_flows (ts);
CREATE INDEX IF NOT EXISTS idx_weather_ts          ON weather (ts);
