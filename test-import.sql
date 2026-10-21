ALTER TABLE price_daily ADD COLUMN wholesale_raw_unit INTEGER;
ALTER TABLE price_latest ADD COLUMN wholesale_raw_unit INTEGER;
UPDATE price_daily SET wholesale_raw_unit = wholesale_unit WHERE wholesale_raw_unit IS NULL;
UPDATE price_latest SET wholesale_raw_unit = wholesale_unit WHERE wholesale_raw_unit IS NULL;
INSERT OR IGNORE INTO district (id, name_bn, name_en, division_id) VALUES (0, 'জাতীয়', 'National', 0);
