-- One row per station x fuel x day, from the first to the last day we collected that pair.
-- Raw is a snapshot per run and a day can have several runs, so each day keeps the latest run.
-- Days with no run for a pair carry the previous price forward (observed_that_day = FALSE).
-- Parsing happens here (raw keeps the text as the API sends it); bad values are flagged, not deleted.
-- Days are UTC collection days; price_updated_at is only informative (DGEG local time, no zone).
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
    DATE(collected_at) AS collected_date,
    collected_at
  FROM `fuel-monitor-pt.fuel_monitor.raw_station_prices`
  WHERE TRUE
),

daily_snapshots AS (
  SELECT *
  FROM parsed
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY station_id, fuel_id, collected_date
    ORDER BY collected_at DESC
  ) = 1
),

-- Each snapshot is valid until the day before the next one; the last one only on its own day.
validity AS (
  SELECT
    *,
    COALESCE(
      DATE_SUB(LEAD(collected_date) OVER (PARTITION BY station_id, fuel_id ORDER BY collected_date), INTERVAL 1 DAY),
      collected_date
    ) AS valid_to
  FROM daily_snapshots
),

daily AS (
  SELECT
    v.* EXCEPT (collected_at, collected_date, valid_to),
    price_date,
    price_date = v.collected_date AS observed_that_day
  FROM validity AS v
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(v.collected_date, v.valid_to)) AS price_date
),

with_previous AS (
  SELECT
    *,
    LAG(price_eur) OVER (PARTITION BY station_id, fuel_id ORDER BY price_date) AS previous_price_eur,
    LAG(price_date) OVER (PARTITION BY station_id, fuel_id ORDER BY price_date) AS previous_price_date
  FROM daily
)

SELECT
  p.* EXCEPT (previous_price_eur, previous_price_date),
  p.previous_price_eur,
  -- NULL only on a pair's first day; an unparseable price on either side counts as a change
  IF(p.previous_price_date IS NULL, NULL, p.price_eur IS DISTINCT FROM p.previous_price_eur) AS is_price_change,
  f.fuel_name,
  f.unit,
  COALESCE(f.is_fleet_fuel, FALSE) AS is_fleet_fuel,
  p.price_eur IS NULL OR p.price_eur <= 0 OR p.price_updated_at IS NULL AS is_suspect_price
FROM with_previous AS p
LEFT JOIN `fuel-monitor-pt.fuel_monitor.stg_fuel_types` AS f USING (fuel_id);
