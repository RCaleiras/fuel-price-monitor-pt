-- Must return 0 rows. The "Unknown" row (station_sk = -1) exists exactly once, and no other row has a negative key.
SELECT COUNTIF(station_sk = -1) AS n_unknown, COUNTIF(station_sk < -1) AS n_below_minus_one
FROM `fuel-monitor-pt.fuel_monitor.dim_stations`
HAVING COUNTIF(station_sk = -1) != 1 OR COUNTIF(station_sk < -1) > 0;
