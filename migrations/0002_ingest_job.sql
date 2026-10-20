-- Ingest job state.
--
-- This lives in D1 and not in KV on purpose: KV is eventually consistent
-- (up to ~60s), and the ingest chain hands off from one request to the next
-- immediately. With KV the next step could read a stale (or missing) job and
-- the chain would die silently. D1 is strongly consistent, so a write is
-- always visible to the next read.

CREATE TABLE IF NOT EXISTS ingest_job (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  job_json    TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_post (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  price_date  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  message_id  TEXT,
  sent_at     TEXT NOT NULL,
  UNIQUE (price_date, kind)
);
