-- One row per station. station_sk is the key facts must use; station_code is the DGEG id (kept for lookups only).
-- Same rules as dim_fuel_type: a table that grows, never rebuilt. A station that already has a row keeps its
-- station_sk forever, a new station gets the next number (MAX + 1). Name, brand, address and so on are overwritten
-- when DGEG changes them (latest wins, no history; the limit is noted in the README).
-- station_sk = -1 is the "Unknown" row: facts use COALESCE(d.station_sk, -1), so they never hold NULL.
-- Stations DGEG stopped publishing stay here with their last known attributes (the daily series carries them).
-- Run by src/build_models.py after each collection; safe to run again (it only adds what is missing).
CREATE TABLE IF NOT EXISTS `fuel-monitor-pt.fuel_monitor.dim_stations` (
  station_sk INT64 NOT NULL,
  station_code INT64 NOT NULL,
  station_name STRING,
  station_type STRING,
  brand STRING,
  district STRING,
  municipality STRING,
  locality STRING,
  address STRING,
  postal_code STRING,
  latitude FLOAT64,
  longitude FLOAT64
);

INSERT INTO `fuel-monitor-pt.fuel_monitor.dim_stations` (station_sk, station_code, station_name)
SELECT -1, -1, 'Unknown'
FROM (SELECT 1)
WHERE NOT EXISTS (SELECT 1 FROM `fuel-monitor-pt.fuel_monitor.dim_stations` WHERE station_sk = -1);

-- One row per station from the latest day. If a station's fuels disagree (some observed, some carried), the
-- observed one wins, then the lowest fuel_id, so the pick is always the same.
CREATE TEMP TABLE latest_stations AS
SELECT
  station_id AS station_code,
  station_name,
  station_type,
  brand,
  district,
  municipality,
  locality,
  address,
  postal_code,
  latitude,
  longitude
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
WHERE price_date = (SELECT MAX(price_date) FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`)
  AND station_id IS NOT NULL
QUALIFY ROW_NUMBER() OVER (PARTITION BY station_id ORDER BY observed_that_day DESC, fuel_id) = 1;

-- New stations only: the next numbers after the current maximum (the first real station gets 1).
INSERT INTO `fuel-monitor-pt.fuel_monitor.dim_stations`
SELECT
  GREATEST((SELECT MAX(station_sk) FROM `fuel-monitor-pt.fuel_monitor.dim_stations`), 0)
    + ROW_NUMBER() OVER (ORDER BY station_code),
  station_code,
  station_name,
  station_type,
  brand,
  district,
  municipality,
  locality,
  address,
  postal_code,
  latitude,
  longitude
FROM latest_stations
WHERE station_code NOT IN (SELECT station_code FROM `fuel-monitor-pt.fuel_monitor.dim_stations`);

-- Existing stations keep their station_sk; only the descriptive columns follow the source.
UPDATE `fuel-monitor-pt.fuel_monitor.dim_stations` AS d
SET
  station_name = s.station_name,
  station_type = s.station_type,
  brand = s.brand,
  district = s.district,
  municipality = s.municipality,
  locality = s.locality,
  address = s.address,
  postal_code = s.postal_code,
  latitude = s.latitude,
  longitude = s.longitude
FROM latest_stations AS s
WHERE d.station_code = s.station_code
  AND TO_JSON_STRING(STRUCT(
        d.station_name, d.station_type, d.brand, d.district, d.municipality,
        d.locality, d.address, d.postal_code, d.latitude, d.longitude))
    != TO_JSON_STRING(STRUCT(
        s.station_name, s.station_type, s.brand, s.district, s.municipality,
        s.locality, s.address, s.postal_code, s.latitude, s.longitude));
