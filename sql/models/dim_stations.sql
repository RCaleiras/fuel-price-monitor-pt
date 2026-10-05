-- One row per station. station_sk is the key facts must use; station_code is the DGEG id (kept for lookups only).
-- Same rules as dim_fuel_type: a table that grows, never rebuilt. A station that already has a row keeps its
-- station_sk forever, a new station gets the next number (MAX + 1). Name, brand, address and so on are overwritten
-- when DGEG changes them (latest wins, no history; the limit is noted in the README).
-- Where the station is (district, municipality, locality) lives in dim_location; the station only holds location_sk.
-- The street address, postal code and coordinates stay here, because they belong to the station itself.
-- station_sk = -1 is the "Unknown" row: facts use COALESCE(d.station_sk, -1), so they never hold NULL.
-- Stations DGEG stopped publishing stay here with their last known attributes (the daily series carries them).
-- Must run after dim_location (src/build_models.py runs files in name order).
-- Run by src/build_models.py after each collection; safe to run again (it only adds what is missing).
CREATE TABLE IF NOT EXISTS `fuel-monitor-pt.fuel_monitor.dim_stations` (
  station_sk INT64 NOT NULL,
  station_code INT64 NOT NULL,
  station_name STRING,
  station_type STRING,
  brand STRING,
  location_sk INT64,
  address STRING,
  postal_code STRING,
  latitude FLOAT64,
  longitude FLOAT64
);

-- One-time migration of the old layout (district, municipality, locality as text columns on this table). It runs
-- only while the old columns still exist: every station gets the location_sk of its place, then the text columns go.
IF EXISTS (
  SELECT 1
  FROM `fuel-monitor-pt.fuel_monitor.INFORMATION_SCHEMA.COLUMNS`
  WHERE table_name = 'dim_stations' AND column_name = 'municipality'
) THEN
  ALTER TABLE `fuel-monitor-pt.fuel_monitor.dim_stations` ADD COLUMN IF NOT EXISTS location_sk INT64;

  UPDATE `fuel-monitor-pt.fuel_monitor.dim_stations` AS d
  SET location_sk = COALESCE(l.location_sk, -1)
  FROM (
    SELECT
      station_sk,
      UPPER(CONCAT(
        NULLIF(TRIM(REGEXP_REPLACE(district, r'\s+', ' ')), ''), '|',
        NULLIF(TRIM(REGEXP_REPLACE(municipality, r'\s+', ' ')), ''), '|',
        COALESCE(NULLIF(TRIM(REGEXP_REPLACE(locality, r'\s+', ' ')), ''), 'Unknown')
      )) AS location_key
    FROM `fuel-monitor-pt.fuel_monitor.dim_stations`
  ) AS k
  LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_location` AS l ON l.location_key = k.location_key
  WHERE d.station_sk = k.station_sk;

  ALTER TABLE `fuel-monitor-pt.fuel_monitor.dim_stations` DROP COLUMN IF EXISTS district;
  ALTER TABLE `fuel-monitor-pt.fuel_monitor.dim_stations` DROP COLUMN IF EXISTS municipality;
  ALTER TABLE `fuel-monitor-pt.fuel_monitor.dim_stations` DROP COLUMN IF EXISTS locality;
END IF;

INSERT INTO `fuel-monitor-pt.fuel_monitor.dim_stations` (station_sk, station_code, station_name, location_sk)
SELECT -1, -1, 'Unknown', -1
FROM (SELECT 1)
WHERE NOT EXISTS (SELECT 1 FROM `fuel-monitor-pt.fuel_monitor.dim_stations` WHERE station_sk = -1);

-- One row per station from the latest day. If a station's fuels disagree (some observed, some carried), the
-- observed one wins, then the lowest fuel_id, so the pick is always the same.
-- The place is matched to dim_location with the same key rule (capitals, extra spaces removed); no match gives -1.
CREATE TEMP TABLE latest_stations AS
SELECT
  p.station_id AS station_code,
  p.station_name,
  p.station_type,
  p.brand,
  COALESCE(l.location_sk, -1) AS location_sk,
  p.address,
  p.postal_code,
  p.latitude,
  p.longitude
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices` AS p
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_location` AS l
  ON l.location_key = UPPER(CONCAT(
    NULLIF(TRIM(REGEXP_REPLACE(p.district, r'\s+', ' ')), ''), '|',
    NULLIF(TRIM(REGEXP_REPLACE(p.municipality, r'\s+', ' ')), ''), '|',
    COALESCE(NULLIF(TRIM(REGEXP_REPLACE(p.locality, r'\s+', ' ')), ''), 'Unknown')
  ))
WHERE p.price_date = (SELECT MAX(price_date) FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`)
  AND p.station_id IS NOT NULL
QUALIFY ROW_NUMBER() OVER (PARTITION BY p.station_id ORDER BY p.observed_that_day DESC, p.fuel_id) = 1;

-- New stations only: the next numbers after the current maximum (the first real station gets 1).
INSERT INTO `fuel-monitor-pt.fuel_monitor.dim_stations`
  (station_sk, station_code, station_name, station_type, brand, location_sk, address, postal_code, latitude, longitude)
SELECT
  GREATEST((SELECT MAX(station_sk) FROM `fuel-monitor-pt.fuel_monitor.dim_stations`), 0)
    + ROW_NUMBER() OVER (ORDER BY station_code),
  station_code,
  station_name,
  station_type,
  brand,
  location_sk,
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
  location_sk = s.location_sk,
  address = s.address,
  postal_code = s.postal_code,
  latitude = s.latitude,
  longitude = s.longitude
FROM latest_stations AS s
WHERE d.station_code = s.station_code
  AND TO_JSON_STRING(STRUCT(
        d.station_name, d.station_type, d.brand, d.location_sk,
        d.address, d.postal_code, d.latitude, d.longitude))
    != TO_JSON_STRING(STRUCT(
        s.station_name, s.station_type, s.brand, s.location_sk,
        s.address, s.postal_code, s.latitude, s.longitude));
