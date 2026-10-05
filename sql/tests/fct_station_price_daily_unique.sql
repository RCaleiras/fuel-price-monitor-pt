-- Must return 0 rows. One row per station x fuel x day.
SELECT station_sk, fuel_sk, price_date, COUNT(*) AS n_rows
FROM `fuel-monitor-pt.fuel_monitor.fct_station_price_daily`
GROUP BY station_sk, fuel_sk, price_date
HAVING COUNT(*) > 1;
