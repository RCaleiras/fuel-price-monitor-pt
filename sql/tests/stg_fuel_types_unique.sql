-- Must return 0 rows. Every fuel_id appears once (the latest load wins).
SELECT fuel_id, COUNT(*) AS n_rows
FROM `fuel-monitor-pt.fuel_monitor.stg_fuel_types`
GROUP BY fuel_id
HAVING COUNT(*) > 1;
