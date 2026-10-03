-- Must return 0 rows. Every station x fuel pair has one row for each day between its first and last day.
SELECT station_id, fuel_id, MIN(price_date) AS first_day, MAX(price_date) AS last_day, COUNT(*) AS n_days
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
GROUP BY station_id, fuel_id
HAVING COUNT(*) != DATE_DIFF(MAX(price_date), MIN(price_date), DAY) + 1;
