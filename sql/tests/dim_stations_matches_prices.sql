-- Must return 0 rows. Every station in stg_station_prices has a row in dim_stations (no fact would fall back to -1).
SELECT DISTINCT p.station_id
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices` AS p
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_stations` AS d ON d.station_code = p.station_id
WHERE p.station_id IS NOT NULL
  AND d.station_sk IS NULL;
