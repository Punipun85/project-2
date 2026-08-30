import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "recommender.py"
SPEC = importlib.util.spec_from_file_location("entertainment_recommender", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

ContentRecord = MODULE.ContentRecord
UserTaste = MODULE.UserTaste
UniversalHybridRecommender = MODULE.UniversalHybridRecommender


CATALOG = [
    ContentRecord("aot", "Attack on Titan", "anime", ("Action", "Drama"), ("War", "Moral ambiguity", "Freedom"), "Japanese", "Japan", 8.6, 99, "Wit Studio"),
    ContentRecord("vinland", "Vinland Saga", "anime", ("Action", "Drama"), ("War", "Redemption", "Freedom"), "Japanese", "Japan", 8.8, 94, "Wit Studio"),
    ContentRecord("geass", "Code Geass", "anime", ("Action", "Sci-Fi"), ("Genius protagonist", "Strategic", "Rebellion"), "Japanese", "Japan", 8.7, 93, "Sunrise"),
    ContentRecord("death-note", "Death Note", "anime", ("Mystery", "Thriller"), ("Genius protagonist", "Psychological", "Moral ambiguity"), "Japanese", "Japan", 8.6, 98, "Madhouse"),
    ContentRecord("twenty-five", "Twenty Five Twenty One", "kdrama", ("Romance", "Drama"), ("First love", "Bittersweet", "Emotional"), "Korean", "South Korea", 8.6, 91),
    ContentRecord("crash-landing", "Crash Landing on You", "kdrama", ("Romance", "Drama"), ("Forbidden love", "Emotional", "Found family"), "Korean", "South Korea", 8.7, 96),
    ContentRecord("your-name", "Your Name", "movie", ("Romance", "Animation"), ("First love", "Bittersweet", "Emotional"), "Japanese", "Japan", 8.4, 96, "CoMix Wave Films"),
    ContentRecord("interstellar", "Interstellar", "movie", ("Sci-Fi", "Drama"), ("Family", "Time", "Emotional"), "English", "United States", 8.7, 98),
]


class RecommendationTests(unittest.TestCase):
    def setUp(self):
        self.engine = UniversalHybridRecommender()

    def test_anime_recommendation_from_attack_on_titan_taste(self):
        taste = UserTaste(
            content_types=("anime",),
            genres=("Action", "Drama"),
            themes=("War", "Moral ambiguity", "Freedom"),
            languages=("Japanese",),
            countries=("Japan",),
            liked_content_ids=("aot",),
        )
        titles = [result.content.title for result in self.engine.recommend(taste, CATALOG, 3)]
        self.assertIn("Vinland Saga", titles)
        self.assertTrue(any(title in titles for title in ("Code Geass", "Death Note")))

    def test_kdrama_sad_romance_search(self):
        results = self.engine.search("Korean romance drama with a sad bittersweet ending", CATALOG, 3)
        self.assertEqual(results[0].content.title, "Twenty Five Twenty One")
        self.assertIn("Crash Landing on You", [result.content.title for result in results])

    def test_cross_category_emotional_romance(self):
        taste = UserTaste(
            content_types=("movie", "kdrama"),
            genres=("Romance", "Drama"),
            themes=("First love", "Bittersweet", "Emotional"),
            languages=("Japanese", "Korean"),
            countries=("Japan", "South Korea"),
            liked_content_ids=("your-name", "twenty-five"),
        )
        results = self.engine.recommend(taste, CATALOG, 3)
        self.assertEqual(results[0].content.title, "Crash Landing on You")
        self.assertGreater(results[0].final_score, 0.65)


if __name__ == "__main__":
    unittest.main()
