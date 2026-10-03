-- Must return 0 rows. One row per station x fuel x day.
SELECT station_id, fuel_id, price_date, COUNT(*) AS n_rows
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
GROUP BY station_id, fuel_id, price_date
HAVING COUNT(*) > 1;
