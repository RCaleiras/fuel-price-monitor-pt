-- Must return 0 rows. Every date appears once.
SELECT date_key, COUNT(*) AS n_rows
FROM `fuel-monitor-pt.fuel_monitor.dim_date`
GROUP BY date_key
HAVING COUNT(*) > 1;
