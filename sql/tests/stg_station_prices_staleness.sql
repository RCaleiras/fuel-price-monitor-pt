-- Must return 0 rows. days_since_last_observed is 0 exactly on observed days and never negative.
-- days_since_price_update is the age of price_updated_at (UTC date) on that day: NULL only when the
-- timestamp could not be parsed, and never negative.
SELECT station_id, fuel_id, price_date, observed_that_day, days_since_last_observed, days_since_price_update
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
WHERE days_since_last_observed IS NULL
  OR days_since_last_observed < 0
  OR observed_that_day != (days_since_last_observed = 0)
  OR (price_updated_at IS NULL) != (days_since_price_update IS NULL)
  OR days_since_price_update < 0;
