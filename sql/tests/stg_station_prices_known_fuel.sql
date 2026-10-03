-- Must return 0 rows. Every price row maps to a fuel type, so unit and fleet scope are never missing.
SELECT DISTINCT fuel_id
FROM `fuel-monitor-pt.fuel_monitor.stg_station_prices`
WHERE fuel_name IS NULL;
