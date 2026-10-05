-- One row per fuel type. fuel_sk is the key facts must use; fuel_code is the DGEG id (kept for lookups only).
-- This is a table that grows, never rebuilt: a fuel that already has a row keeps its fuel_sk forever, a new fuel
-- gets the next number (MAX + 1). Name, unit and fleet flag are overwritten if they change (no history).
-- fuel_sk = -1 is the "Unknown" row: facts use COALESCE(d.fuel_sk, -1) when a fuel is missing, so they never hold NULL.
-- Run by src/build_models.py after each collection; safe to run again (it only adds what is missing).
CREATE TABLE IF NOT EXISTS `fuel-monitor-pt.fuel_monitor.dim_fuel_type` (
  fuel_sk INT64 NOT NULL,
  fuel_code INT64 NOT NULL,
  fuel_name STRING,
  unit STRING,
  is_fleet_fuel BOOL
);

INSERT INTO `fuel-monitor-pt.fuel_monitor.dim_fuel_type` (fuel_sk, fuel_code, fuel_name, unit, is_fleet_fuel)
SELECT -1, -1, 'Unknown', CAST(NULL AS STRING), FALSE
FROM (SELECT 1)
WHERE NOT EXISTS (SELECT 1 FROM `fuel-monitor-pt.fuel_monitor.dim_fuel_type` WHERE fuel_sk = -1);

-- The fuels of the latest day (the daily series carries every fuel ever collected, so none disappears).
CREATE TEMP TABLE latest_fuels AS
SELECT DISTINCT fuel_id AS fuel_code, fuel_name, unit, is_fleet_fuel
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
WHERE price_date = (SELECT MAX(price_date) FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`);

-- New fuels only: the next numbers after the current maximum (the first real fuel gets 1).
INSERT INTO `fuel-monitor-pt.fuel_monitor.dim_fuel_type` (fuel_sk, fuel_code, fuel_name, unit, is_fleet_fuel)
SELECT
  GREATEST((SELECT MAX(fuel_sk) FROM `fuel-monitor-pt.fuel_monitor.dim_fuel_type`), 0)
    + ROW_NUMBER() OVER (ORDER BY fuel_code),
  fuel_code,
  fuel_name,
  unit,
  is_fleet_fuel
FROM latest_fuels
WHERE fuel_code NOT IN (SELECT fuel_code FROM `fuel-monitor-pt.fuel_monitor.dim_fuel_type`);

-- Existing fuels keep their fuel_sk; only the descriptive columns follow the source.
UPDATE `fuel-monitor-pt.fuel_monitor.dim_fuel_type` AS d
SET fuel_name = s.fuel_name, unit = s.unit, is_fleet_fuel = s.is_fleet_fuel
FROM latest_fuels AS s
WHERE d.fuel_code = s.fuel_code
  AND (d.fuel_name IS DISTINCT FROM s.fuel_name
    OR d.unit IS DISTINCT FROM s.unit
    OR d.is_fleet_fuel IS DISTINCT FROM s.is_fleet_fuel);
