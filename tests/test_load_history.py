import io
import zipfile
from datetime import date, datetime

import pytest

from src import load_history as lh

DEFINITION = """<?xml version="1.0" encoding="UTF-8"?>
<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" recordCount="3">
  <cacheFields count="4">
    <cacheField name="Data"><sharedItems><d v="2010-01-04T00:00:00"/><d v="2010-01-11T00:00:00"/></sharedItems></cacheField>
    <cacheField name="Combustivel"><sharedItems><s v="GPL Auto"/><s v="Gasóleo"/></sharedItems></cacheField>
    <cacheField name="Componente"><sharedItems><s v="PVP"/><s v="IVA"/></sharedItems></cacheField>
    <cacheField name="Valor Médio"><sharedItems containsNumber="1"/></cacheField>
  </cacheFields>
</pivotCacheDefinition>""".encode("utf-8")

RECORDS = """<?xml version="1.0" encoding="UTF-8"?>
<pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3">
  <r><x v="0"/><x v="0"/><x v="0"/><n v="0.55"/></r>
  <r><x v="1"/><x v="1"/><x v="1"/><n v="0.25"/></r>
  <r><d v="2010-01-18T00:00:00"/><s v="Fuel"/><x v="0"/><n v="0.7"/></r>
</pivotCacheRecords>""".encode("utf-8")


def build_workbook(definition: bytes = DEFINITION, records: bytes = RECORDS) -> zipfile.ZipFile:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(lh.CACHE_DEFINITION, definition)
        archive.writestr(lh.CACHE_RECORDS, records)
    return zipfile.ZipFile(buffer)


def test_weekly_rows_resolve_shared_indexes_and_inline_values():
    rows = lh.weekly_national_rows(build_workbook())

    assert rows == [
        {"week_start": "2010-01-04", "fuel_type": "GPL Auto", "component": "PVP", "value_eur": 0.55},
        {"week_start": "2010-01-11", "fuel_type": "Gasóleo", "component": "IVA", "value_eur": 0.25},
        {"week_start": "2010-01-18", "fuel_type": "Fuel", "component": "PVP", "value_eur": 0.7},
    ]


def test_weekly_rows_fail_when_record_count_mismatches():
    wrong = DEFINITION.replace(b'recordCount="3"', b'recordCount="4"')

    with pytest.raises(RuntimeError, match="recordCount"):
        lh.weekly_national_rows(build_workbook(definition=wrong))


def test_weekly_rows_fail_when_a_record_has_the_wrong_cell_count():
    short = RECORDS.replace(b'<n v="0.55"/>', b"")

    with pytest.raises(RuntimeError, match="cells"):
        lh.weekly_national_rows(build_workbook(records=short))


def sheet(*body: tuple) -> list[tuple]:
    return [(None, None), ("Data", "Gasolina 95", "GPL Auto"), *body]


def test_legacy_rows_drop_annual_averages_and_keep_footnoted_dates():
    rows = lh.legacy_rows(
        sheet(
            ("Média Anual 2009", 1.2, 0.5),
            (datetime(2009, 12, 28), 1.283, 0.618),
            ("2009-06-08 (*)", 1.28, None),
            (None, None, None),
        )
    )

    assert rows == [
        {"week_start": "2009-12-28", "fuel_type": "Gasolina 95", "value_eur": 1.283},
        {"week_start": "2009-12-28", "fuel_type": "GPL Auto", "value_eur": 0.618},
        {"week_start": "2009-06-08", "fuel_type": "Gasolina 95", "value_eur": 1.28},
    ]


def test_legacy_rows_fail_on_unknown_row_label():
    with pytest.raises(RuntimeError, match="unrecognised"):
        lh.legacy_rows(sheet(("Total", 1.0, 1.0)))


def test_legacy_rows_fail_without_header():
    with pytest.raises(RuntimeError, match="header"):
        lh.legacy_rows([(datetime(2009, 1, 5), 1.0)])


def test_parse_flat_date_accepts_dates_and_rejects_text():
    assert lh.parse_flat_date(datetime(2009, 1, 5)) == date(2009, 1, 5)
    assert lh.parse_flat_date("2009-06-08 (*)") == date(2009, 6, 8)
    assert lh.parse_flat_date("Média Anual 2009") is None
