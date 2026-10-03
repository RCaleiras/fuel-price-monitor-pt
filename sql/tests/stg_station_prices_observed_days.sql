-- Must return 0 rows. observed_that_day is TRUE exactly when raw has a row for that station x fuel
-- on that day (UTC); otherwise the price was carried forward from an earlier day.
WITH raw_days AS (
  SELECT DISTINCT Id AS station_id, fuel_id, DATE(collected_at) AS price_date, TRUE AS in_raw
  FROM `fuel-monitor-pt.fuel_monitor.raw_station_prices`
)

SELECT s.station_id, s.fuel_id, s.price_date, s.observed_that_day
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices` AS s
LEFT JOIN raw_days AS r USING (station_id, fuel_id, price_date)
WHERE s.observed_that_day IS DISTINCT FROM COALESCE(r.in_raw, FALSE);
