import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationServiceConfig,
  requestPersonalizedRecommendations,
} from "../lib/recommendation-client";

const config = createRecommendationServiceConfig({
  RECOMMENDATION_API_URL: "https://recommendations.example/recommendations",
  RECOMMENDATION_API_KEY: "test-only",
});

test("recommendation client sends authenticated user only to the Python service", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let authorization: string | null = null;
  const fetchImplementation: typeof fetch = async (_input, init) => {
    assert.equal(
      String(_input),
      "https://recommendations.example/recommendations",
    );
    requestBody = JSON.parse(String(init?.body));
    authorization = new Headers(init?.headers).get("authorization");
    return Response.json([
      {
        content_id: 42,
        external_id: "16498",
        source: "JIKAN",
        title: "Fantasy Result",
        content_type: "anime",
        genres: ["Fantasy"],
        themes: ["Adventure"],
        content_score: 0.9,
        collaborative_score: 0.7,
        context_score: 0.8,
        final_score: 0.82,
        reason: "Recommended because it matches your interest in fantasy.",
        strategy: "personalized_hybrid",
      },
    ]);
  };

  const results = await requestPersonalizedRecommendations(
    { userId: "13dd748e-4df8-4b73-88c7-d5fa705e3b2d", limit: 6 },
    { config, fetchImplementation },
  );

  assert.equal(requestBody?.user_id, "13dd748e-4df8-4b73-88c7-d5fa705e3b2d");
  assert.equal(authorization, "Bearer test-only");
  assert.equal(results[0].scores.final, 0.82);
  assert.equal(results[0].recommendationStrategy, "personalized_hybrid");
});

test("recommendation client requires both service URL and API key", async () => {
  const incomplete = createRecommendationServiceConfig({
    RECOMMENDATION_API_URL: "https://recommendations.example/recommendations",
  });
  assert.equal(incomplete.isConfigured, false);
  await assert.rejects(
    requestPersonalizedRecommendations({ limit: 3 }, { config: incomplete }),
    /Recommendation service is not configured/,
  );
});

test("recommendation client supports anonymous cold-start results", async () => {
  const results = await requestPersonalizedRecommendations(
    { limit: 3 },
    {
      config,
      fetchImplementation: async () =>
        Response.json([
          {
            content_id: 1,
            external_id: "1",
            source: "TMDB",
            title: "Trending Film",
            content_type: "movie",
            content_score: 0.3,
            collaborative_score: 0.9,
            context_score: 0.5,
            final_score: 0.52,
            strategy: "cold_start_trending",
          },
        ]),
    },
  );

  assert.equal(results[0].title, "Trending Film");
  assert.equal(results[0].recommendationStrategy, "cold_start_trending");
});
