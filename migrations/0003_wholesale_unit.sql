-- Record the upstream's own wholesale unit separately.
--
-- The wholesale figure is divided down to the commodity's retail unit, so
-- that is the unit it is *in* and the only honest label to publish. The
-- upstream's original unit ("quintal") is kept here for audit, together with
-- the divisor that bridges the two.

ALTER TABLE price_daily ADD COLUMN wholesale_raw_unit INTEGER;
ALTER TABLE price_latest ADD COLUMN wholesale_raw_unit INTEGER;

UPDATE price_daily SET wholesale_raw_unit = wholesale_unit WHERE wholesale_raw_unit IS NULL;
UPDATE price_latest SET wholesale_raw_unit = wholesale_unit WHERE wholesale_raw_unit IS NULL;

-- The national aggregate is not a district. Give it a name so it can never
-- be rendered as "0" in a district column.
INSERT OR IGNORE INTO district (id, name_bn, name_en, division_id)
VALUES (0, 'জাতীয়', 'National', 0);
