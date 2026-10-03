-- Must return 0 rows. previous_price_eur is the price of the day before. is_price_change is NULL on a
-- pair's first day only (nothing to compare with); every other day it is TRUE or FALSE, even when
-- the previous price could not be parsed.
WITH checked AS (
  SELECT
    *,
    LAG(price_eur) OVER (PARTITION BY station_id, fuel_id ORDER BY price_date) AS expected_previous_price_eur,
    price_date = MIN(price_date) OVER (PARTITION BY station_id, fuel_id) AS is_first_day
  FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
)

SELECT station_id, fuel_id, price_date, price_eur, previous_price_eur, is_price_change
FROM checked
WHERE previous_price_eur IS DISTINCT FROM expected_previous_price_eur
  OR (is_first_day AND is_price_change IS NOT NULL)
  OR (
    NOT is_first_day
    AND is_price_change IS DISTINCT FROM (price_eur IS DISTINCT FROM expected_previous_price_eur)
  );
