-- Must return 0 rows. Every fuel_id appears once (a fuel renamed by DGEG would show up twice).
SELECT fuel_id, COUNT(*) AS n_rows
FROM `fuel-monitor-pt.fuel_monitor.dim_fuel_type`
GROUP BY fuel_id
HAVING COUNT(*) > 1;
