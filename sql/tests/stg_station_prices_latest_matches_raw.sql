-- Must return 0 rows. On each pair's last collection day, the daily price equals the price of the
-- latest raw run: carrying prices forward must never drift from what the API last told us.
WITH latest_raw AS (
  SELECT
    Id AS station_id,
    fuel_id,
    DATE(collected_at) AS price_date,
    SAFE_CAST(REPLACE(REGEXP_REPLACE(Preco, r'[^0-9,]', ''), ',', '.') AS NUMERIC) AS raw_price_eur
  FROM `fuel-monitor-pt.fuel_monitor.raw_station_prices`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY Id, fuel_id ORDER BY collected_at DESC) = 1
)

SELECT r.station_id, r.fuel_id, r.price_date, r.raw_price_eur, s.price_eur AS staging_price_eur
FROM latest_raw AS r
LEFT JOIN `fuel-monitor-pt.fuel_monitor.stg_station_prices` AS s
  USING (station_id, fuel_id, price_date)
WHERE s.price_eur IS DISTINCT FROM r.raw_price_eur;
