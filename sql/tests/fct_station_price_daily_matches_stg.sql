-- Must return 0 rows. The fact keeps every row of stg_station_prices (none lost, none added),
-- including the observed / carried split.
WITH fct AS (
  SELECT COUNT(*) AS n_rows, COUNTIF(observed_that_day) AS n_observed
  FROM `fuel-monitor-pt.fuel_monitor.fct_station_price_daily`
),
stg AS (
  SELECT COUNT(*) AS n_rows, COUNTIF(observed_that_day) AS n_observed
  FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
)
SELECT fct.n_rows AS fct_rows, stg.n_rows AS stg_rows, fct.n_observed AS fct_observed, stg.n_observed AS stg_observed
FROM fct CROSS JOIN stg
WHERE fct.n_rows != stg.n_rows OR fct.n_observed != stg.n_observed;
