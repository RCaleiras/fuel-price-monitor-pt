-- The dashboard stations list (sql/dashboard/02_stations.sql) must have one row per DGEG station code: the site
-- refers to stations by position, so two rows for one code would split its prices. Must return 0 rows.
-- The 30-day window (INTERVAL 29 DAY) mirrors DEFAULT_WINDOW_DAYS in src/export_dashboard.py: change both together.
WITH bounds AS (
  SELECT MAX(price_date) AS latest_date
  FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily`
),

stations AS (
  SELECT DISTINCT
    r.station_code, r.station_name, r.station_type, r.brand, r.district, r.municipality, r.locality, r.address,
    r.latitude, r.longitude
  FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily` AS r
  CROSS JOIN bounds AS b
  WHERE r.observed_that_day
    AND NOT r.is_suspect_price
    AND r.station_sk <> -1
    AND r.fuel_sk <> -1
    AND r.price_date BETWEEN DATE_SUB(b.latest_date, INTERVAL 29 DAY) AND b.latest_date
)

SELECT station_code, COUNT(*) AS n_rows
FROM stations
GROUP BY station_code
HAVING COUNT(*) > 1
