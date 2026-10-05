-- Must return 0 rows. The fleet scope is exactly 7 fuels; fewer means a fuel was renamed by DGEG
-- (the list in stg_station_prices is by name), more means it was changed by mistake.
SELECT COUNTIF(is_fleet_fuel) AS n_fleet_fuels
FROM `fuel-monitor-pt.fuel_monitor.dim_fuel_type`
HAVING COUNTIF(is_fleet_fuel) != 7;
