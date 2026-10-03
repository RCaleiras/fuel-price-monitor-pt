-- Must return 0 rows. previous_price_eur is the price of the day before, and is_price_change is TRUE only
-- when the price differs from it (NULL on a pair's first day, when we have nothing to compare with).
WITH expected AS (
  SELECT
    *,
    LAG(price_eur) OVER (PARTITION BY station_id, fuel_id ORDER BY price_date) AS expected_previous_price_eur
  FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
)

SELECT station_id, fuel_id, price_date, price_eur, previous_price_eur, is_price_change
FROM expected
WHERE previous_price_eur IS DISTINCT FROM expected_previous_price_eur
  OR is_price_change IS DISTINCT FROM IF(
    expected_previous_price_eur IS NULL, NULL, price_eur != expected_previous_price_eur
  );
