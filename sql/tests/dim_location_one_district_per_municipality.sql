-- Must return 0 rows. A municipality belongs to exactly one district, so district > municipality > locality is a clean hierarchy.
SELECT municipality, COUNT(DISTINCT district) AS n_districts
FROM `fuel-monitor-pt.fuel_monitor.dim_location`
WHERE location_sk > 0
GROUP BY municipality
HAVING COUNT(DISTINCT district) > 1;
