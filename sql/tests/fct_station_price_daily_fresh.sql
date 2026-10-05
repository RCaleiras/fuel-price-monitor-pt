-- Must return 0 rows. The fact reaches the same latest day as stg_station_prices (it was rebuilt after the last run).
SELECT fct.latest AS fct_latest, stg.latest AS stg_latest
FROM (SELECT MAX(price_date) AS latest FROM `fuel-monitor-pt.fuel_monitor.fct_station_price_daily`) AS fct
CROSS JOIN (SELECT MAX(price_date) AS latest FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`) AS stg
WHERE fct.latest IS DISTINCT FROM stg.latest;
