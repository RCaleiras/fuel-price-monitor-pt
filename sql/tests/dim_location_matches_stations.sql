-- Must return 0 rows. Every real station points to a real location: the key exists in dim_location and is not the -1 Unknown row.
SELECT s.station_sk, s.station_code, s.location_sk
FROM `fuel-monitor-pt.fuel_monitor.dim_stations` AS s
LEFT JOIN `fuel-monitor-pt.fuel_monitor.dim_location` AS l ON l.location_sk = s.location_sk
WHERE s.station_sk > 0
  AND (l.location_sk IS NULL OR l.location_sk = -1);
