-- Must return 0 rows. No fact falls back to the -1 Unknown member. A hit means a dimension is missing a
-- station or a fuel that appears in the prices (build_models did not run, or a code changed).
SELECT COUNTIF(station_sk = -1) AS n_unknown_station, COUNTIF(fuel_sk = -1) AS n_unknown_fuel
FROM `fuel-monitor-pt.fuel_monitor.fct_station_price_daily`
HAVING COUNTIF(station_sk = -1) > 0 OR COUNTIF(fuel_sk = -1) > 0;
