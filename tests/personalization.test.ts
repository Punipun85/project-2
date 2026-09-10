import assert from "node:assert/strict";
import test from "node:test";

import { analyzeTasteProfile, buildTasteDocument } from "../lib/personalization";

test("onboarding genres and fantasy ratings create a fantasy-led taste profile", () => {
  const profile = analyzeTasteProfile(
    ["Fantasy", "Adventure", "Drama"],
    [
      { rating: 5, contents: { title: "Frieren", genres: ["Fantasy", "Adventure"], themes: ["emotional"] } },
      { rating: 5, contents: { title: "Dungeon Meshi", genres: ["Fantasy", "Comedy"] } },
    ],
    [],
    [],
  );
  assert.equal(profile.genreScores.fantasy, 1);
  assert.ok(profile.genreScores.adventure > profile.genreScores.drama);
  assert.ok(profile.styles.includes("emotional"));
});

test("completed sci-fi viewing increases sci-fi preference", () => {
  const profile = analyzeTasteProfile(
    ["Drama", "Mystery", "Romance"],
    [],
    [],
    [
      { progress: 100, completed: true, contents: { title: "Interstellar", genres: ["Sci-Fi", "Drama"], themes: ["space exploration"] } },
      { progress: 95, completed: true, contents: { title: "Arrival", genres: ["Sci-Fi", "Drama"] } },
    ],
  );
  assert.ok(profile.genreScores["sci-fi"] > profile.genreScores.romance);
  assert.ok(profile.styles.includes("space exploration"));
});

test("user embedding document contains preferences and highly rated titles", () => {
  const ratings = [{ rating: 5, contents: { title: "Frieren", genres: ["Fantasy"] } }];
  const profile = analyzeTasteProfile(["Fantasy", "Adventure", "Drama"], ratings, [], []);
  const document = buildTasteDocument(profile, ratings);
  assert.match(document, /fantasy/i);
  assert.match(document, /Frieren 5\/5/);
});
