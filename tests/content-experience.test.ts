import assert from "node:assert/strict";
import test from "node:test";

import { buildDeterministicExplanation } from "../lib/content-experience";
import { trailerEmbedUrl } from "../lib/trailer";

test("personalized explanation uses matching taste and positive history", () => {
  const explanation = buildDeterministicExplanation(
    { title: "Frieren", type: "anime", genres: ["Fantasy", "Adventure"], themes: ["Emotional"], rating: 8.9 },
    ["fantasy", "drama"],
    ["emotional"],
    ["Attack on Titan"],
  );
  assert.match(explanation, /Fantasy/);
  assert.match(explanation, /Emotional/);
  assert.match(explanation, /Attack on Titan/);
});

test("trailer URLs are converted to privacy-enhanced safe embeds", () => {
  assert.equal(
    trailerEmbedUrl("https://www.youtube.com/watch?v=zSWdZVtXT7E"),
    "https://www.youtube-nocookie.com/embed/zSWdZVtXT7E",
  );
  assert.equal(trailerEmbedUrl("https://example.com/video"), null);
  assert.equal(trailerEmbedUrl("javascript:alert(1)"), null);
});
