-- One row per fuel type, read from the latest day of stg_station_prices (the daily series carries every fuel
-- we have ever collected, so a fuel DGEG stops publishing stays here).
-- fuel_name, unit and is_fleet_fuel are decided in stg_station_prices; this table only lists them.
CREATE OR REPLACE VIEW `fuel-monitor-pt.fuel_monitor.dim_fuel_type` AS
SELECT DISTINCT
  fuel_id,
  fuel_name,
  unit,
  is_fleet_fuel
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
WHERE price_date = (SELECT MAX(price_date) FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`);
