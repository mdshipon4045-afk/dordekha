-- দরদেখা (Dordekha) — D1 schema
-- Source: Ministry of Agriculture / DAM official daily price report.
-- Design rule: every published number is traceable to a source row.

PRAGMA foreign_keys = ON;

-- ── Master data (refreshed from the upstream dropdowns endpoint) ────────────
CREATE TABLE IF NOT EXISTS district (
  id           INTEGER PRIMARY KEY,
  name_bn      TEXT NOT NULL,
  name_en      TEXT,
  division_id  INTEGER
);

CREATE TABLE IF NOT EXISTS upazila (
  id           INTEGER PRIMARY KEY,
  name_bn      TEXT NOT NULL,
  name_en      TEXT,
  district_id  INTEGER,
  division_id  INTEGER
);

CREATE TABLE IF NOT EXISTS commodity (
  id               INTEGER PRIMARY KEY,
  name_bn          TEXT NOT NULL,
  name_en          TEXT,
  group_id         INTEGER,
  sub_group_id     INTEGER,
  unit_retail      INTEGER,
  unit_wholesale   INTEGER
);

CREATE TABLE IF NOT EXISTS commodity_group (
  id       INTEGER PRIMARY KEY,
  name_bn  TEXT,
  name_en  TEXT
);

CREATE TABLE IF NOT EXISTS unit (
  id       INTEGER PRIMARY KEY,
  name_bn  TEXT,
  name_en  TEXT
);

CREATE INDEX IF NOT EXISTS idx_upazila_district ON upazila(district_id);
CREATE INDEX IF NOT EXISTS idx_commodity_group ON commodity(group_id);

-- ── The fact table ──────────────────────────────────────────────────────────
-- upazila_id = 0 means the figure is the district-level aggregate.
-- All prices are expressed in the commodity's RETAIL unit (see src/units.ts).
CREATE TABLE IF NOT EXISTS price_daily (
  price_date            TEXT    NOT NULL,
  district_id           INTEGER NOT NULL,
  upazila_id            INTEGER NOT NULL DEFAULT 0,
  commodity_id          INTEGER NOT NULL,
  group_id              INTEGER NOT NULL,
  sub_group_id          INTEGER NOT NULL,
  retail_min            REAL,
  retail_max            REAL,
  retail_avg            REAL,
  retail_unit           INTEGER,
  wholesale_min         REAL,
  wholesale_max         REAL,
  wholesale_avg         REAL,
  wholesale_unit        INTEGER,
  wholesale_divisor     REAL,
  wholesale_divisor_src TEXT,
  carried_forward       INTEGER NOT NULL DEFAULT 0,
  anomaly               TEXT,
  ingested_at           TEXT    NOT NULL,
  PRIMARY KEY (price_date, district_id, upazila_id, commodity_id)
);

-- Hot read path: one row per (place, commodity) for the most recent report.
CREATE TABLE IF NOT EXISTS price_latest (
  district_id           INTEGER NOT NULL,
  upazila_id            INTEGER NOT NULL DEFAULT 0,
  commodity_id          INTEGER NOT NULL,
  group_id              INTEGER NOT NULL,
  sub_group_id          INTEGER NOT NULL,
  price_date            TEXT    NOT NULL,
  retail_min            REAL,
  retail_max            REAL,
  retail_avg            REAL,
  retail_unit           INTEGER,
  wholesale_min         REAL,
  wholesale_max         REAL,
  wholesale_avg         REAL,
  wholesale_unit        INTEGER,
  wholesale_divisor     REAL,
  wholesale_divisor_src TEXT,
  carried_forward       INTEGER NOT NULL DEFAULT 0,
  anomaly               TEXT,
  updated_at            TEXT    NOT NULL,
  PRIMARY KEY (district_id, upazila_id, commodity_id)
);

CREATE INDEX IF NOT EXISTS idx_pd_commodity_date ON price_daily(commodity_id, price_date);
CREATE INDEX IF NOT EXISTS idx_pd_district_date   ON price_daily(district_id, price_date);
CREATE INDEX IF NOT EXISTS idx_pd_date            ON price_daily(price_date);

-- ── Ingest bookkeeping ──────────────────────────────────────────────────────
-- The health endpoint asserts on this: "did today's ingest actually write?".
CREATE TABLE IF NOT EXISTS ingest_run (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  price_date        TEXT    NOT NULL,
  scope             TEXT    NOT NULL,   -- 'district' | 'upazila' | 'national'
  started_at        TEXT    NOT NULL,
  finished_at       TEXT,
  rows_written      INTEGER NOT NULL DEFAULT 0,
  districts_ok      INTEGER NOT NULL DEFAULT 0,
  districts_missing INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL,   -- 'ok' | 'partial' | 'failed'
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingest_date ON ingest_run(price_date, scope);

-- ── Licensing & metering ────────────────────────────────────────────────────
-- Supports the "licence, not the data" model: the free tier is public,
-- commercial use requires a licence key.
CREATE TABLE IF NOT EXISTS license (
  id           TEXT PRIMARY KEY,
  key_hash     TEXT NOT NULL UNIQUE,
  plan         TEXT NOT NULL,          -- free | commercial | api | enterprise
  label        TEXT,
  contact      TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  calls_used   INTEGER NOT NULL DEFAULT 0,
  calls_limit  INTEGER NOT NULL DEFAULT 0   -- 0 = unlimited
);

CREATE TABLE IF NOT EXISTS usage_event (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT,
  at         TEXT NOT NULL,
  endpoint   TEXT,
  source     TEXT,                        -- 'mcp' | 'api' | 'page'
  status     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_usage_license ON usage_event(license_id, at);

-- ── Site content (for the citation surface) ─────────────────────────────────
-- Rendered, citable, machine-readable statements about the dataset itself.
CREATE TABLE IF NOT EXISTS content_page (
  slug        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,   -- 'dataset' | 'methodology' | 'licence' | 'index'
  title_bn    TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  body_md     TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ── Alerts (price threshold subscriptions) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_rule (
  id            TEXT PRIMARY KEY,
  commodity_id  INTEGER NOT NULL,
  district_id   INTEGER,
  direction     TEXT NOT NULL,   -- 'above' | 'below'
  threshold     REAL NOT NULL,
  channel       TEXT NOT NULL,   -- 'telegram'
  destination   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_commodity ON alert_rule(commodity_id, active);
