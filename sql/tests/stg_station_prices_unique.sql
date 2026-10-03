-- Must return 0 rows. One row per station x fuel x price change.
SELECT station_id, fuel_id, price_updated_at, COUNT(*) AS n_rows
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
GROUP BY station_id, fuel_id, price_updated_at
HAVING COUNT(*) > 1;
