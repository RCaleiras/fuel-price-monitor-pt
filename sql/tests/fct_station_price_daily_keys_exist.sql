-- Must return 0 rows. Every key of the fact exists in its dimension (station, fuel and date).
SELECT
  COUNTIF(s.station_sk IS NULL) AS n_missing_station,
  COUNTIF(f.fuel_sk IS NULL) AS n_missing_fuel,
  COUNTIF(d.date_key IS NULL) AS n_missing_date
FROM `fuel-monitor-pt.fuel_monitor.fct_station_price_daily` AS fct
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_stations` AS s ON s.station_sk = fct.station_sk
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_fuel_type` AS f ON f.fuel_sk = fct.fuel_sk
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_date` AS d ON d.date_key = fct.price_date
HAVING COUNTIF(s.station_sk IS NULL) > 0 OR COUNTIF(f.fuel_sk IS NULL) > 0 OR COUNTIF(d.date_key IS NULL) > 0;
