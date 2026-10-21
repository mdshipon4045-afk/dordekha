-- Indexes for the read paths.
--
-- Without these, every read of the current prices was a full table scan:
--   * price_latest had no index on commodity_id, so "every district's price
--     for this commodity" scanned the whole table;
--   * "which district has the most rows" grouped over the whole table on
--     every home page load;
--   * MIN/MAX/COUNT over price_daily scanned it too.
--
-- D1's free tier allows 5,000,000 rows read per day. A home page load was
-- reading tens of thousands of rows, which exhausted the budget in hours.

CREATE INDEX IF NOT EXISTS idx_pl_commodity ON price_latest(commodity_id, district_id);
CREATE INDEX IF NOT EXISTS idx_pl_district   ON price_latest(district_id, upazila_id);
CREATE INDEX IF NOT EXISTS idx_pd_date_district ON price_daily(price_date, district_id, commodity_id);
CREATE INDEX IF NOT EXISTS idx_pd_district_commodity ON price_daily(district_id, commodity_id, price_date);
CREATE INDEX IF NOT EXISTS idx_ingest_scope ON ingest_run(scope, status, price_date);
