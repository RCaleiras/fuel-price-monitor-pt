-- Dashboard export: one row per station with at least one published price in the window.
-- Attributes are the current ones (dim_stations overwrites them, no history); the station code is DGEG's own id.
WITH bounds AS (
  SELECT MAX(price_date) AS latest_date
  FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily`
)

SELECT DISTINCT
  r.station_code,
  r.station_name,
  r.station_type,
  r.brand,
  r.district,
  r.municipality,
  r.locality,
  r.address,
  r.latitude,
  r.longitude
FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily` AS r
CROSS JOIN bounds AS b
WHERE r.observed_that_day
  AND NOT r.is_suspect_price
  AND r.station_sk <> -1
  AND r.fuel_sk <> -1
  AND r.price_date BETWEEN DATE_SUB(b.latest_date, INTERVAL @window_days - 1 DAY) AND b.latest_date
ORDER BY r.station_code
