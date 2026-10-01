# Sources (verified 2026-10-01)

## 1. Station prices API
- Endpoint: `https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos`
- Params seen: `idsTiposComb`, `idMarca`, `idTipoPosto`, `idDistrito`, `idsMunicipios`, `qtdPorPagina`, `pagina`
- No authentication. Response keys: `status`, `mensagem`, `resultado[]`, `token`.
- Fields: Id, Nome, TipoPosto, Marca, Combustivel, Preco (text, comma decimal + EUR sign),
  DataAtualizacao (text), Municipio, Distrito, Morada, Localidade, CodPostal, Latitude, Longitude, Quantidade.
- About 3,200 active stations in mainland Portugal (3,175 with a price in the 2026-10-01 snapshot).
- Fuel types come from `GetTiposCombustiveis` (fields `Id`, `Descritivo`, `UnidadeMedida`, `fl_ativo`, `fl_rodoviario`, `fl_ViewWebSite`).
  Collect where `fl_ativo` and `fl_rodoviario` are true: 12 of 14 types, no hard-coded ids.
- `qtdPorPagina=5000` returns each fuel in one page. `Quantidade` is the total for that fuel and matched the rows collected in every run so far.
- A full snapshot is about 14,018 rows. In the first sample only 21% of prices had changed in the last 24h (97% in 7 days).
- Licence: the station dataset on dados.gov.pt is CC BY 4.0 (DGEG). No written terms for the JSON endpoint itself.
  It is the endpoint the DGEG site uses, not a documented public API: it can change without notice.

## 2. Weekly Excel
- URL: `https://www.dgeg.gov.pt/media/x13gkhm4/dgeg-pcr-2004-2026_40_pt.xlsx` (the media id changes when DGEG republishes: re-check the DGEG page).
- Updated weekly (Tuesday, 17:00). Contact: estatistica@dgeg.gov.pt
- Full history sits in a pivot cache (`xl/pivotCache/`), not in the visible cells (the sheets only show the filtered view):
  fields `Data, Combustivel, Componente, Valor Medio, Ano, Semana, Trimestre, Mes`.
  `Data`, `Combustivel`, `Componente`, `Ano`, `Trimestre` and `Mes` are positional indexes into each field's `sharedItems`;
  `Valor Medio` and `Semana` are inline numbers. `src/load_history.py` resolves them and checks the count against `recordCount`.
- Pivot cache coverage: 2010-01-04 to 2026-09-28, 873 weeks, 21 fuel names, 4 components (PST, ISP+Out., IVA, PVP). 50,736 records.
  PVP is the retail price; PST + ISP + IVA should equal PVP.
- Sheet "Precos (2004 a 2009)" is flat (2004-01-02 to 2009-12-28, retail price only, wide format),
  with annual-average rows mixed into the data. Yields 1,930 rows, no duplicates, 7 fuel names.
- No licence stated.

### Data quality findings (checked 2026-10-01)
| Finding | Detail | Handling |
|---|---|---|
| Duplicate keys | 132 `(week, fuel, component)` groups appear twice, all in weeks 2019-12-02 and 2020-07-27. 126 are exact copies. 6 conflict, all for "Fuel" (fuel oil) | Raw keeps the source as is. Deduplicate in staging, add a `unique` test |
| Missing week | 2013-02-04 is absent (one 14-day gap among 873 weeks) | Document, do not fill |
| Negative values | 6, only "Fuel" and "Gas natural comprimido (m3)", component PST | Out of scope for the fleet analysis; flag in staging |
| Fuel names differ | Excel has 21 names; the API and the 2004-2009 sheet use others (e.g. "Gasoleo" vs "Gasoleo simples") | Mapping table `dim_fuel` |
| Component check | PST + ISP + IVA vs PVP fails only on the duplicated rows | Re-run the check after deduplication |

## Rules for the collector
1. One request per fuel type per day. Identify the project in the User-Agent (`fuel-monitor-portfolio`). No personal data in it.
2. Credit DGEG in the README and the dashboard.
3. If DGEG asks to stop or the endpoint changes, fall back to the weekly Excel.

## Open item
Ask DGEG (precoscombustiveis@dgeg.gov.pt) to confirm reuse of both the API and the Excel. Sending is Rui's call.
