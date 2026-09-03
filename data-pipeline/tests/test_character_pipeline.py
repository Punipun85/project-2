"""Unit tests for the isolated Batch 2A character knowledge pipeline."""

from __future__ import annotations

import unittest

from character_pipeline.anilist_character_importer import parse_anilist_response
from character_pipeline.character_normalizer import normalize_character_name, normalize_character_record
from character_pipeline.character_uploader import (
    deduplicate_character_payloads,
    deduplicate_relationship_payloads,
)
from character_pipeline.imdb_character_importer import parse_name_basics_tsv, parse_principals_tsv
from character_pipeline.main_character_pipeline import partition_contents


class CharacterPipelineTests(unittest.TestCase):
    def test_character_name_normalization_and_invalid_values(self) -> None:
        self.assertEqual(normalize_character_name("  tony   stark "), "Tony Stark")
        self.assertEqual(normalize_character_name("Eren Yeager"), "Eren Yeager")
        self.assertIsNone(normalize_character_name("Self"))
        self.assertIsNone(normalize_character_name("---"))

    def test_duplicate_character_names_collapse_case_insensitively(self) -> None:
        first = normalize_character_record(content_id=1, name="Tony Stark", source="IMDB")
        second = normalize_character_record(content_id=2, name="tony   stark", source="TMDB")
        assert first is not None and second is not None

        characters = deduplicate_character_payloads([first, second])

        self.assertEqual(len(characters), 1)
        self.assertEqual(characters[0]["normalized_name"], "tony stark")

    def test_content_relationship_keeps_both_appearances(self) -> None:
        first = normalize_character_record(
            content_id=10,
            name="Tony Stark",
            source="IMDB",
            role="main",
            actor_name="Robert Downey Jr.",
            importance_score=100,
        )
        second = normalize_character_record(
            content_id=20,
            name="Tony Stark",
            source="IMDB",
            role="supporting",
            actor_name="Robert Downey Jr.",
            importance_score=60,
        )
        assert first is not None and second is not None

        relationships = deduplicate_relationship_payloads(
            [first, second],
            {"tony stark": 99},
        )

        self.assertEqual(len(relationships), 2)
        self.assertEqual({row["content_id"] for row in relationships}, {10, 20})
        self.assertTrue(all(row["character_id"] == 99 for row in relationships))

    def test_anilist_response_parser_extracts_role_and_voice_actor(self) -> None:
        payload = {
            "data": {
                "Media": {
                    "characters": {
                        "pageInfo": {"hasNextPage": False},
                        "edges": [
                            {
                                "role": "MAIN",
                                "node": {
                                    "name": {"full": "Eren Yeager", "alternative": ["Eren"]},
                                    "image": {"large": "https://example.test/eren.jpg"},
                                    "description": "<b>Former</b> scout.",
                                },
                                "voiceActors": [{"name": {"full": "Yuuki Kaji"}}],
                            }
                        ],
                    }
                }
            }
        }

        records, has_next = parse_anilist_response(payload, content_id=7)

        self.assertFalse(has_next)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].name, "Eren Yeager")
        self.assertEqual(records[0].role, "main")
        self.assertEqual(records[0].voice_actor, "Yuuki Kaji")
        self.assertEqual(records[0].description, "Former scout.")

    def test_imdb_tsv_parsers_filter_actor_categories_and_resolve_names(self) -> None:
        principals = [
            "tconst\tordering\tnconst\tcategory\tjob\tcharacters\n",
            'tt0371746\t1\tnm0000375\tactor\t\\N\t["Tony Stark"]\n',
            "tt0371746\t2\tnm9999999\tdirector\t\\N\t\\N\n",
            'tt9999999\t1\tnm0000001\tactor\t\\N\t["Other"]\n',
        ]
        names = [
            "nconst\tprimaryName\tbirthYear\tdeathYear\tprimaryProfession\tknownForTitles\n",
            "nm0000375\tRobert Downey Jr.\t1965\t\\N\tactor\ttt0371746\n",
        ]

        credits = parse_principals_tsv(principals, {"tt0371746"})
        actors = parse_name_basics_tsv(names, {"nm0000375"})

        self.assertEqual(len(credits), 1)
        self.assertEqual(credits[0]["characters"], ["Tony Stark"])
        self.assertEqual(actors["nm0000375"], "Robert Downey Jr.")

    def test_content_partition_uses_existing_source_and_external_id_contract(self) -> None:
        groups = partition_contents(
            [
                {"id": 1, "source": "TMDB", "external_id": "157336", "content_type": "movie"},
                {"id": 2, "source": "TMDB", "external_id": "126485", "content_type": "series"},
                {"id": 3, "source": "JIKAN", "external_id": "16498", "content_type": "anime"},
            ]
        )

        self.assertEqual(groups["movies"][0]["external_id"], "157336")
        self.assertEqual(groups["series"][0]["external_id"], "126485")
        self.assertEqual(groups["anime"][0]["external_id"], "16498")


if __name__ == "__main__":
    unittest.main()
