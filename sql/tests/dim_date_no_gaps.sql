-- Must return 0 rows. The calendar has no missing day between its first and last date.
SELECT COUNT(*) AS n_rows, DATE_DIFF(MAX(date_key), MIN(date_key), DAY) + 1 AS n_expected_days
FROM `fuel-monitor-pt.fuel_monitor.dim_date`
HAVING COUNT(*) != DATE_DIFF(MAX(date_key), MIN(date_key), DAY) + 1;
