-- Must return 0 rows. The "Unknown" row (fuel_sk = -1) exists exactly once, and no other row has a negative key.
SELECT COUNTIF(fuel_sk = -1) AS n_unknown, COUNTIF(fuel_sk < -1) AS n_below_minus_one
FROM `fuel-monitor-pt.fuel_monitor.dim_fuel_type`
HAVING COUNTIF(fuel_sk = -1) != 1 OR COUNTIF(fuel_sk < -1) > 0;
