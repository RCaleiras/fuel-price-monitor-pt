-- Must return 0 rows. The "Unknown" row (location_sk = -1) exists exactly once, and no other row has a negative key.
SELECT COUNTIF(location_sk = -1) AS n_unknown, COUNTIF(location_sk < -1) AS n_below_minus_one
FROM `fuel-monitor-pt.fuel_monitor.dim_location`
HAVING COUNTIF(location_sk = -1) != 1 OR COUNTIF(location_sk < -1) > 0;
