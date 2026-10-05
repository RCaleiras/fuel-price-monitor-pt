-- Must return 0 rows. The report view has exactly the rows of the fact (the joins lose and duplicate nothing).
SELECT rpt.n_rows AS rpt_rows, fct.n_rows AS fct_rows
FROM (SELECT COUNT(*) AS n_rows FROM `fuel-monitor-pt.fuel_monitor.rpt_station_price_daily`) AS rpt
CROSS JOIN (SELECT COUNT(*) AS n_rows FROM `fuel-monitor-pt.fuel_monitor.fct_station_price_daily`) AS fct
WHERE rpt.n_rows != fct.n_rows;
