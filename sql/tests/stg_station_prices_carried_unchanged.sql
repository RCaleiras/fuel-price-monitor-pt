-- Must return 0 rows. A carried day (observed_that_day = FALSE) repeats the previous day's price,
-- so it is never a price change.
SELECT station_id, fuel_id, price_date, price_eur, previous_price_eur, is_price_change
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
WHERE NOT observed_that_day
  AND (is_price_change IS DISTINCT FROM FALSE OR price_eur IS DISTINCT FROM previous_price_eur);
