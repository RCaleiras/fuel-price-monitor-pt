-- One row per station x fuel x price change (price_updated_at), deduplicated from the daily snapshots.
-- Raw repeats ~79% of prices every day, and a day can have several runs, so the same price shows up
-- many times. Here it appears once, with first_seen_at / last_seen_at telling when we saw it.
-- Parsing happens here (raw keeps the text as the API sends it); bad values are flagged, not deleted.
CREATE OR REPLACE VIEW `fuel-monitor-pt.fuel_monitor.stg_station_prices` AS
WITH parsed AS (
  SELECT
    Id AS station_id,
    Nome AS station_name,
    TipoPosto AS station_type,
    Marca AS brand,
    fuel_id,
    -- "2,207 €" -> 2.207
    SAFE_CAST(REPLACE(REGEXP_REPLACE(Preco, r'[^0-9,]', ''), ',', '.') AS NUMERIC) AS price_eur,
    -- DGEG publishes Portuguese local time without a zone, so say so explicitly
    SAFE.PARSE_TIMESTAMP('%Y-%m-%d %H:%M', DataAtualizacao, 'Europe/Lisbon') AS price_updated_at,
    Distrito AS district,
    Municipio AS municipality,
    Localidade AS locality,
    Morada AS address,
    CodPostal AS postal_code,
    Latitude AS latitude,
    Longitude AS longitude,
    collected_at
  FROM `fuel-monitor-pt.fuel_monitor.raw_station_prices`
  WHERE TRUE
),

deduplicated AS (
  SELECT
    *,
    MIN(collected_at) OVER (PARTITION BY station_id, fuel_id, price_updated_at) AS first_seen_at
  FROM parsed
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY station_id, fuel_id, price_updated_at
    ORDER BY collected_at DESC
  ) = 1
)

SELECT
  d.* EXCEPT (collected_at),
  d.collected_at AS last_seen_at,
  f.fuel_name,
  f.unit,
  COALESCE(f.is_fleet_fuel, FALSE) AS is_fleet_fuel,
  d.price_eur IS NULL OR d.price_eur <= 0 OR d.price_updated_at IS NULL AS is_suspect_price
FROM deduplicated AS d
LEFT JOIN `fuel-monitor-pt.fuel_monitor.stg_fuel_types` AS f USING (fuel_id);
