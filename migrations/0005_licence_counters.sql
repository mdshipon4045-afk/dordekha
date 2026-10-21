-- The columns the paid tier needs.
--
-- The monthly counter has to remember which calendar month it belongs to,
-- so the allowance can roll over without a scheduled job, and the burst
-- counter has to remember its window for the same reason.
--
-- These are also applied by the worker itself (src/maintenance.ts), because
-- the production database's migration ledger does not match what is
-- actually in it: migrations 0003 and 0004 were applied by hand. Running
-- `wrangler d1 migrations apply` against the production database is
-- therefore not safe — see docs/FAILURE-MODES.md.

ALTER TABLE license ADD COLUMN period TEXT;
ALTER TABLE license ADD COLUMN burst_count INTEGER;
ALTER TABLE license ADD COLUMN burst_window TEXT;
