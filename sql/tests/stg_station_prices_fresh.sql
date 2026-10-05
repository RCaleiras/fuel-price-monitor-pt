-- Must return 0 rows. The staging table reaches the latest collection day in raw (it was rebuilt after the last run).
-- A failed rebuild leaves yesterday's table in place (CREATE OR REPLACE is atomic), and this test catches it.
SELECT stg.latest AS stg_latest, raw.latest AS raw_latest
FROM (SELECT MAX(price_date) AS latest FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`) AS stg
CROSS JOIN (SELECT MAX(DATE(collected_at)) AS latest FROM `fuel-monitor-pt.fuel_monitor.raw_station_prices`) AS raw
WHERE stg.latest IS DISTINCT FROM raw.latest;
