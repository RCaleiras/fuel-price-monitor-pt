-- One row per calendar day. date_key is the date itself and is never NULL, so there is no -1 row.
-- A table that grows, never rebuilt: it only adds the days that are missing, from 2004-01-01 (the start of the DGEG
-- weekly history) to one year ahead, so the weekly facts can use it too.
-- Weeks are ISO weeks (Monday first); day_of_week is 1 = Monday to 7 = Sunday.
-- Run by src/build_models.py after each collection; safe to run again.
CREATE TABLE IF NOT EXISTS `fuel-monitor-pt.fuel_monitor.dim_date` (
  date_key DATE NOT NULL,
  year INT64,
  quarter INT64,
  month INT64,
  month_name STRING,
  iso_week INT64,
  week_start DATE,
  day_of_week INT64,
  day_name STRING,
  is_weekend BOOL
);

INSERT INTO `fuel-monitor-pt.fuel_monitor.dim_date`
SELECT
  d AS date_key,
  EXTRACT(YEAR FROM d) AS year,
  EXTRACT(QUARTER FROM d) AS quarter,
  EXTRACT(MONTH FROM d) AS month,
  FORMAT_DATE('%B', d) AS month_name,
  EXTRACT(ISOWEEK FROM d) AS iso_week,
  DATE_TRUNC(d, ISOWEEK) AS week_start,
  -- BigQuery counts Sunday as 1; shift so Monday is 1 and Sunday is 7
  MOD(EXTRACT(DAYOFWEEK FROM d) + 5, 7) + 1 AS day_of_week,
  FORMAT_DATE('%A', d) AS day_name,
  EXTRACT(DAYOFWEEK FROM d) IN (1, 7) AS is_weekend
FROM UNNEST(GENERATE_DATE_ARRAY(DATE '2004-01-01', DATE_ADD(CURRENT_DATE(), INTERVAL 1 YEAR))) AS d
WHERE d NOT IN (SELECT date_key FROM `fuel-monitor-pt.fuel_monitor.dim_date`);
