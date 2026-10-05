-- Daily price fact: one row per station x fuel x day, every row of stg_station_prices.
-- Carried prices (days with no run, stations DGEG stopped publishing) are kept and flagged, never dropped:
-- observed_that_day and days_since_last_observed let the report layer decide the cutoff, so it can change without a rebuild.
-- Rebuilt in full on each run (CREATE OR REPLACE is atomic, readers never see an empty table). A day can change after
-- it lands (second run on the same day, skipped days), so appending only the new day would leave stale rows.
-- Facts hold keys, not names: station_sk and fuel_sk come from the dimensions (join on the DGEG code) and fall back to
-- -1 "Unknown" when the dimension has no row, so the keys are never NULL. Station attributes are the current ones.
-- Must run after dim_stations and dim_fuel_type (src/build_models.py runs files in name order: dim_* before fct_*).
CREATE OR REPLACE TABLE `fuel-monitor-pt.fuel_monitor.fct_station_price_daily` AS
SELECT
  p.price_date,
  COALESCE(s.station_sk, -1) AS station_sk,
  COALESCE(f.fuel_sk, -1) AS fuel_sk,
  p.price_eur,
  p.previous_price_eur,
  p.price_eur - p.previous_price_eur AS price_change_eur,
  p.is_price_change,
  p.observed_that_day,
  p.days_since_last_observed,
  p.days_since_price_update,
  p.price_updated_at,
  p.is_suspect_price
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices` AS p
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_stations` AS s ON s.station_code = p.station_id
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_fuel_type` AS f ON f.fuel_code = p.fuel_id;
