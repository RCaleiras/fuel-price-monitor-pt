-- Dashboard export: the published prices of each station x fuel in the window, one array per pair.
-- Carried prices (observed_that_day = FALSE) are left out, so a day with no published price is simply missing.
-- last_price_updated_at is the DGEG timestamp of the latest published price (local time, information only).
WITH bounds AS (
  SELECT MAX(price_date) AS latest_date
  FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily`
)

SELECT
  r.station_code,
  r.fuel_sk,
  ARRAY_AGG(STRUCT(r.price_date, r.price_eur) ORDER BY r.price_date) AS prices,
  ARRAY_AGG(r.price_updated_at ORDER BY r.price_date DESC LIMIT 1)[SAFE_OFFSET(0)] AS last_price_updated_at
FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily` AS r
CROSS JOIN bounds AS b
WHERE r.observed_that_day
  AND NOT r.is_suspect_price
  AND r.station_sk <> -1
  AND r.fuel_sk <> -1
  AND r.price_date BETWEEN DATE_SUB(b.latest_date, INTERVAL @window_days - 1 DAY) AND b.latest_date
GROUP BY r.station_code, r.fuel_sk
ORDER BY r.station_code, r.fuel_sk
