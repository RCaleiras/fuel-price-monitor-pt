-- One row per fuel type, taken from the latest load of raw_fuel_types.
-- is_fleet_fuel marks the fuels in scope for the fleet analysis (see docs/schema.md).
-- The list is by name because the names are what the business uses; ids only join the tables.
CREATE OR REPLACE VIEW `fuel-monitor-pt.fuel_monitor.stg_fuel_types` AS
SELECT
  Id AS fuel_id,
  Descritivo AS fuel_name,
  UnidadeMedida AS unit,
  fl_ativo AS is_active,
  fl_rodoviario AS is_road,
  Descritivo IN (
    'Gasóleo simples',
    'Gasóleo especial',
    'Gasolina simples 95',
    'Gasolina especial 95',
    'Gasolina 98',
    'Gasolina especial 98',
    'GPL Auto'
  ) AS is_fleet_fuel
FROM `fuel-monitor-pt.fuel_monitor.raw_fuel_types`
WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY collected_at DESC) = 1;
