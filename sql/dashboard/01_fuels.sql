-- Dashboard export: the fuels with at least one published price in the window, with their unit.
-- Read by src/export_dashboard.py; @window_days is the number of days up to the latest collection day.
-- Published prices only (observed_that_day) and no suspect price: the dashboard's "current price" rule.
WITH bounds AS (
  SELECT MAX(price_date) AS latest_date
  FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily`
)

SELECT
  r.fuel_sk,
  r.fuel_name,
  r.unit,
  r.is_fleet_fuel,
  COUNT(*) AS n_prices
FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily` AS r
CROSS JOIN bounds AS b
WHERE r.observed_that_day
  AND NOT r.is_suspect_price
  AND r.fuel_sk <> -1
  AND r.price_date BETWEEN DATE_SUB(b.latest_date, INTERVAL @window_days - 1 DAY) AND b.latest_date
GROUP BY r.fuel_sk, r.fuel_name, r.unit, r.is_fleet_fuel
ORDER BY r.fuel_sk
