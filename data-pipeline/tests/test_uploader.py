from __future__ import annotations

import unittest

from database.uploader import SupabaseUploader


class FakeQuery:
    def execute(self):
        return self


class FakeTable:
    def __init__(self) -> None:
        self.calls: list[tuple[list[dict], dict]] = []

    def upsert(self, rows, **options):
        self.calls.append((rows, options))
        return FakeQuery()


class FakeClient:
    def __init__(self) -> None:
        self.contents = FakeTable()
        self.selected_table: str | None = None

    def table(self, name):
        self.selected_table = name
        return self.contents


class UploaderTests(unittest.TestCase):
    def test_supabase_upload_uses_batches_of_at_most_100(self) -> None:
        client = FakeClient()
        uploader = SupabaseUploader(client, batch_size=100)
        records = [
            {"source": "TMDB", "external_id": str(index), "title": f"Title {index}"}
            for index in range(205)
        ]

        imported = uploader.upload_batch(records)

        self.assertEqual(imported, 205)
        self.assertEqual(client.selected_table, "contents")
        self.assertEqual([len(rows) for rows, _ in client.contents.calls], [100, 100, 5])
        for _, options in client.contents.calls:
            self.assertEqual(options["on_conflict"], "source,external_id")
            self.assertFalse(options["default_to_null"])

    def test_duplicate_prevention_keeps_last_source_external_id_record(self) -> None:
        client = FakeClient()
        uploader = SupabaseUploader(client)
        records = [
            {"source": "TMDB", "external_id": "1", "title": "Old title"},
            {"source": "TMDB", "external_id": "1", "title": "New title"},
            {"source": "MAL", "external_id": "1", "title": "Different provider"},
        ]

        imported = uploader.upload_batch(records)
        uploaded_rows = [row for rows, _ in client.contents.calls for row in rows]

        self.assertEqual(imported, 2)
        self.assertEqual(len(uploaded_rows), 2)
        self.assertIn(
            {"source": "TMDB", "external_id": "1", "title": "New title"},
            uploaded_rows,
        )
        self.assertIn(
            {"source": "MAL", "external_id": "1", "title": "Different provider"},
            uploaded_rows,
        )


if __name__ == "__main__":
    unittest.main()
