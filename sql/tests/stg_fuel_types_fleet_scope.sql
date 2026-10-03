-- Must return 0 rows. The fleet scope is exactly 7 fuels; fewer means a fuel was renamed by DGEG
-- (the list in stg_fuel_types is by name), more means it was changed by mistake.
SELECT COUNTIF(is_fleet_fuel) AS n_fleet_fuels
FROM `fuel-monitor-pt.fuel_monitor.stg_fuel_types`
HAVING COUNTIF(is_fleet_fuel) != 7;
