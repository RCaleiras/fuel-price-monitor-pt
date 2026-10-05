-- One row per place: district > municipality > locality. location_sk is the key facts and dim_stations must use.
-- DGEG has no id for places, so location_key is the natural key: district|municipality|locality in capitals, with
-- extra spaces removed. This merges the spellings DGEG mixes for the same place (Faro / FARO, "Marinhais " / Marinhais).
-- Same rules as the other dimensions: a table that grows, never rebuilt. A place that already has a row keeps its
-- location_sk forever, a new place gets the next number (MAX + 1). Display names are overwritten when they change
-- (latest wins, no history).
-- Display name of a place: the spelling that is not all capitals, then the most frequent one, then alphabetical.
-- If DGEG only ever sends capitals for a place, it stays in capitals (known limit, noted in the README).
-- A station with no locality gets the locality "Unknown" inside its municipality, so municipality analysis still works.
-- location_sk = -1 is the "Unknown" row for a station with no district or municipality at all.
-- Places whose stations DGEG stopped publishing stay here.
-- Must run before dim_stations (src/build_models.py runs files in name order). Safe to run again.
CREATE TABLE IF NOT EXISTS `fuel-monitor-pt.fuel_monitor.dim_location` (
  location_sk INT64 NOT NULL,
  location_key STRING NOT NULL,
  district STRING,
  municipality STRING,
  locality STRING
);

INSERT INTO `fuel-monitor-pt.fuel_monitor.dim_location` (location_sk, location_key, district, municipality, locality)
SELECT -1, 'UNKNOWN', 'Unknown', 'Unknown', 'Unknown'
FROM (SELECT 1)
WHERE NOT EXISTS (SELECT 1 FROM `fuel-monitor-pt.fuel_monitor.dim_location` WHERE location_sk = -1);

-- Latest day only, like dim_stations. Spellings are counted per station so the most frequent one wins.
CREATE TEMP TABLE latest_locations AS
WITH cleaned AS (
  SELECT
    NULLIF(TRIM(REGEXP_REPLACE(district, r'\s+', ' ')), '') AS district,
    NULLIF(TRIM(REGEXP_REPLACE(municipality, r'\s+', ' ')), '') AS municipality,
    COALESCE(NULLIF(TRIM(REGEXP_REPLACE(locality, r'\s+', ' ')), ''), 'Unknown') AS locality
  FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
  WHERE price_date = (SELECT MAX(price_date) FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`)
    AND station_id IS NOT NULL
),
spellings AS (
  SELECT district, municipality, locality, COUNT(*) AS n_rows
  FROM cleaned
  WHERE district IS NOT NULL AND municipality IS NOT NULL
  GROUP BY district, municipality, locality
)
SELECT
  UPPER(CONCAT(district, '|', municipality, '|', locality)) AS location_key,
  district,
  municipality,
  locality
FROM spellings
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY UPPER(CONCAT(district, '|', municipality, '|', locality))
  ORDER BY
    CONCAT(district, municipality, locality) != UPPER(CONCAT(district, municipality, locality)) DESC,
    n_rows DESC,
    district, municipality, locality
) = 1;

-- New places only: the next numbers after the current maximum (the first real place gets 1).
INSERT INTO `fuel-monitor-pt.fuel_monitor.dim_location`
SELECT
  GREATEST((SELECT MAX(location_sk) FROM `fuel-monitor-pt.fuel_monitor.dim_location`), 0)
    + ROW_NUMBER() OVER (ORDER BY location_key),
  location_key,
  district,
  municipality,
  locality
FROM latest_locations
WHERE location_key NOT IN (SELECT location_key FROM `fuel-monitor-pt.fuel_monitor.dim_location`);

-- Existing places keep their location_sk; only the display names follow the source.
UPDATE `fuel-monitor-pt.fuel_monitor.dim_location` AS d
SET
  district = s.district,
  municipality = s.municipality,
  locality = s.locality
FROM latest_locations AS s
WHERE d.location_key = s.location_key
  AND TO_JSON_STRING(STRUCT(d.district, d.municipality, d.locality))
    != TO_JSON_STRING(STRUCT(s.district, s.municipality, s.locality));
