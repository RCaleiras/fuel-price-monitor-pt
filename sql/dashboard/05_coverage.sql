-- Dashboard export: overall coverage of the daily series (all days collected so far, not only the window).
SELECT
  MIN(price_date) AS first_date,
  MAX(price_date) AS latest_date,
  COUNT(DISTINCT price_date) AS n_days
FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily`
