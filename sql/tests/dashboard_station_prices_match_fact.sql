-- The dashboard export (sql/dashboard/03_station_prices.sql, default 30-day window) must hold exactly the published,
-- non-suspect prices of the fact table: rebuilt here from the fact and dim_stations, not from the report view.
-- Returns one row per difference; must return 0 rows.
-- The 30-day window (INTERVAL 29 DAY) mirrors DEFAULT_WINDOW_DAYS in src/export_dashboard.py: change both together.
WITH bounds AS (
  SELECT MAX(price_date) AS latest_date
  FROM `fuel-monitor-pt.fuel_monitor.fct_station_price_daily`
),

fact AS (
  SELECT s.station_code, f.fuel_sk, f.price_date, f.price_eur
  FROM `fuel-monitor-pt.fuel_monitor.fct_station_price_daily` AS f
  JOIN `fuel-monitor-pt.fuel_monitor.dim_stations` AS s ON s.station_sk = f.station_sk
  CROSS JOIN bounds AS b
  WHERE f.observed_that_day
    AND NOT f.is_suspect_price
    AND f.station_sk <> -1
    AND f.fuel_sk <> -1
    AND f.price_date BETWEEN DATE_SUB(b.latest_date, INTERVAL 29 DAY) AND b.latest_date
),

export AS (
  SELECT
    r.station_code,
    r.fuel_sk,
    ARRAY_AGG(STRUCT(r.price_date, r.price_eur) ORDER BY r.price_date) AS prices
  FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily` AS r
  CROSS JOIN bounds AS b
  WHERE r.observed_that_day
    AND NOT r.is_suspect_price
    AND r.station_sk <> -1
    AND r.fuel_sk <> -1
    AND r.price_date BETWEEN DATE_SUB(b.latest_date, INTERVAL 29 DAY) AND b.latest_date
  GROUP BY r.station_code, r.fuel_sk
),

flat AS (
  SELECT e.station_code, e.fuel_sk, p.price_date, p.price_eur
  FROM export AS e, UNNEST(e.prices) AS p
)

SELECT 'missing_from_export' AS issue, d.*
FROM (SELECT * FROM fact EXCEPT DISTINCT SELECT * FROM flat) AS d
UNION ALL
SELECT 'not_in_fact' AS issue, d.*
FROM (SELECT * FROM flat EXCEPT DISTINCT SELECT * FROM fact) AS d
UNION ALL
-- a pair must not appear twice (the site indexes prices by station x fuel)
SELECT 'duplicate_pair', station_code, fuel_sk, CAST(NULL AS DATE), CAST(NULL AS NUMERIC)
FROM export
GROUP BY station_code, fuel_sk
HAVING COUNT(*) > 1
