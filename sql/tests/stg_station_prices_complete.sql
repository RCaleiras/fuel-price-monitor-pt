-- Must return 0 rows. Every station x fuel pair in raw is still in staging: deduplicating
-- must never make a station disappear.
SELECT DISTINCT r.Id AS station_id, r.fuel_id
FROM `fuel-monitor-pt.fuel_monitor.raw_station_prices` AS r
LEFT JOIN `fuel-monitor-pt.fuel_monitor.stg_station_prices` AS s
  ON s.station_id = r.Id AND s.fuel_id = r.fuel_id
WHERE s.station_id IS NULL;
