-- Must return 0 rows. Every location_sk and every location_key appears once.
SELECT 'location_sk' AS key_name, CAST(location_sk AS STRING) AS key_value, COUNT(*) AS n_rows
FROM `fuel-monitor-pt.fuel_monitor.dim_location`
GROUP BY location_sk
HAVING COUNT(*) > 1
UNION ALL
SELECT 'location_key', location_key, COUNT(*)
FROM `fuel-monitor-pt.fuel_monitor.dim_location`
GROUP BY location_key
HAVING COUNT(*) > 1;
