-- Dashboard export: per fuel and day, how many prices were published, carried or changed.
-- n_carried counts the rows kept from an earlier day (stations DGEG stopped publishing), shown as a coverage note.
-- n_changes counts published prices that differ from the day before (is_price_change; NULL on a pair's first day).
WITH bounds AS (
  SELECT MAX(price_date) AS latest_date
  FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily`
)

SELECT
  r.fuel_sk,
  r.price_date,
  COUNTIF(r.observed_that_day AND NOT r.is_suspect_price) AS n_published,
  COUNTIF(NOT r.observed_that_day) AS n_carried,
  COUNTIF(r.observed_that_day AND NOT r.is_suspect_price AND r.is_price_change) AS n_changes,
  COUNTIF(r.is_suspect_price) AS n_suspect
FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily` AS r
CROSS JOIN bounds AS b
WHERE r.fuel_sk <> -1
  AND r.price_date BETWEEN DATE_SUB(b.latest_date, INTERVAL @window_days - 1 DAY) AND b.latest_date
GROUP BY r.fuel_sk, r.price_date
ORDER BY r.fuel_sk, r.price_date
