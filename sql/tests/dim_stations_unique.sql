-- Must return 0 rows. Every station_sk and every station_code appears once.
SELECT 'station_sk' AS key_name, CAST(station_sk AS STRING) AS key_value, COUNT(*) AS n_rows
FROM `fuel-monitor-pt.fuel_monitor.dim_stations`
GROUP BY station_sk
HAVING COUNT(*) > 1
UNION ALL
SELECT 'station_code', CAST(station_code AS STRING), COUNT(*)
FROM `fuel-monitor-pt.fuel_monitor.dim_stations`
GROUP BY station_code
HAVING COUNT(*) > 1;
