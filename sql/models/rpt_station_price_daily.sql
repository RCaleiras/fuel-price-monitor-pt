-- Report view for Looker Studio: the daily fact with the station, fuel and date attributes already joined.
-- No stale-price cutoff here on purpose: filter on observed_that_day or days_since_last_observed in the dashboard
-- (the cutoff is decided after the 2026-10-17 re-check of the "DGEG hides stale prices" hypothesis).
-- Station attributes are the current ones (dim_stations overwrites them, no history).
-- district, municipality and locality come from dim_location (through the station); the address stays on the station.
-- Every join is on a key that always exists (the dimensions hold the -1 Unknown row), so no row is lost.
CREATE OR REPLACE VIEW `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily` AS
SELECT
  fct.price_date,
  dt.year,
  dt.month,
  dt.month_name,
  dt.iso_week,
  dt.week_start,
  dt.day_of_week,
  dt.day_name,
  dt.is_weekend,
  fct.station_sk,
  st.station_code,
  st.station_name,
  st.station_type,
  st.brand,
  loc.district,
  loc.municipality,
  loc.locality,
  st.address,
  st.latitude,
  st.longitude,
  fct.fuel_sk,
  fu.fuel_name,
  fu.unit,
  fu.is_fleet_fuel,
  fct.price_eur,
  fct.previous_price_eur,
  fct.price_change_eur,
  fct.is_price_change,
  fct.observed_that_day,
  fct.days_since_last_observed,
  fct.days_since_price_update,
  fct.price_updated_at,
  fct.is_suspect_price
FROM `fuel-monitor-pt.fuel_monitor.fct_station_price_daily` AS fct
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_date` AS dt ON dt.date_key = fct.price_date
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_stations` AS st ON st.station_sk = fct.station_sk
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_location` AS loc ON loc.location_sk = st.location_sk
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_fuel_type` AS fu ON fu.fuel_sk = fct.fuel_sk;
