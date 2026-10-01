"""One-off loader: DGEG weekly Excel -> BigQuery (national history).

Run as `python -m src.load_history`. Rui writes the logic.
Details of the file layout are in docs/sources.md.
"""


# TODO 1: download the Excel (see docs/sources.md for the URL, re-check it on the DGEG page).
# TODO 2: read the pivot cache from the .xlsx zip (xl/pivotCache/*). Resolve the shared-list indexes
#         for Data, Combustivel, Componente.
# TODO 3: output a long table: week_start, fuel_type, component, value_eur.
# TODO 4: handle the flat sheet "Precos (2004 a 2009)" separately; drop the annual-average rows.
# TODO 5: load into BigQuery raw tables.
def main() -> None:
    raise NotImplementedError


if __name__ == "__main__":
    main()
