# Sources (verified 2026-10-01)

## 1. Station prices API
- Endpoint: `https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos`
- Params seen: `idsTiposComb`, `idMarca`, `idTipoPosto`, `idDistrito`, `idsMunicipios`, `qtdPorPagina`, `pagina`
- No authentication. Response keys: `status`, `mensagem`, `resultado[]`, `token`.
- Fields: Id, Nome, TipoPosto, Marca, Combustivel, Preco (text, comma decimal + EUR sign),
  DataAtualizacao (text), Municipio, Distrito, Morada, Localidade, CodPostal, Latitude, Longitude, Quantidade.
- About 3,200 active stations in mainland Portugal.
- Licence: the station dataset on dados.gov.pt is CC BY 4.0 (DGEG). No written terms for the JSON endpoint itself.
  It is the endpoint the DGEG site uses, not a documented public API: it can change without notice.

## 2. Weekly Excel
- URL: `https://www.dgeg.gov.pt/media/x13gkhm4/dgeg-pcr-2004-2026_40_pt.xlsx` (the media id changes when DGEG republishes: re-check the DGEG page).
- Updated weekly (Tuesday, 17:00). Contact: estatistica@dgeg.gov.pt
- Full history sits in a pivot cache, not in the visible cells:
  fields `Data, Combustivel, Componente, Valor Medio, Ano, Semana, Trimestre, Mes`; text fields are shared-list indexes.
- Sheet "Precos (2004 a 2009)" is flat, with annual-average rows mixed into the data.
- No licence stated.

## Rules for the collector
1. One request per fuel type per day. Identify the project in the User-Agent (`fuel-monitor-portfolio`). No personal data in it.
2. Credit DGEG in the README and the dashboard.
3. If DGEG asks to stop or the endpoint changes, fall back to the weekly Excel.

## Open item
Ask DGEG (precoscombustiveis@dgeg.gov.pt) to confirm reuse of both the API and the Excel. Sending is Rui's call.
