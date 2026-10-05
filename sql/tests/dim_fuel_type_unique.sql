-- Must return 0 rows. Every fuel_sk and every fuel_code appears once.
SELECT 'fuel_sk' AS key_name, CAST(fuel_sk AS STRING) AS key_value, COUNT(*) AS n_rows
FROM `fuel-monitor-pt.fuel_monitor.dim_fuel_type`
GROUP BY fuel_sk
HAVING COUNT(*) > 1
UNION ALL
SELECT 'fuel_code', CAST(fuel_code AS STRING), COUNT(*)
FROM `fuel-monitor-pt.fuel_monitor.dim_fuel_type`
GROUP BY fuel_code
HAVING COUNT(*) > 1;
