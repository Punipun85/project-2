import assert from "node:assert/strict";
import test from "node:test";

import {
  EnvironmentValidationError,
  requireEnvironmentValue,
  safeEnvironmentSummary,
  validateProductionServiceUrls,
} from "../lib/env";
import {
  createEmbeddingConfig,
  generateEmbedding,
} from "../lib/embedding-client";

test("missing required variables produce a readable variable-specific error", () => {
  assert.throws(
    () => requireEnvironmentValue("EMBEDDING_API_URL", {}),
    (error: unknown) =>
      error instanceof EnvironmentValidationError &&
      error.message === "Missing required environment variable: EMBEDDING_API_URL",
  );
});

test("local mode accepts and calls a local embedding endpoint", async () => {
  const config = createEmbeddingConfig({
    APP_ENV: "local",
    NODE_ENV: "development",
    EMBEDDING_API_URL: "http://192.168.1.20:8000/ai/embed",
    EMBEDDING_API_KEY: "local-test-key",
    EMBEDDING_MODEL: "sentence-transformers/all-MiniLM-L6-v2",
  });
  assert.equal(config.isConfigured, true);

  const result = await generateEmbedding("local test", {
    config,
    fetchImplementation: async (input, init) => {
      assert.equal(String(input), "http://192.168.1.20:8000/ai/embed");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer local-test-key");
      return Response.json({
        embedding: Array.from({ length: 384 }, () => 0.01),
        model: "sentence-transformers/all-MiniLM-L6-v2",
        dimension: 384,
      });
    },
  });
  assert.equal(result.length, 384);
});

test("production mode rejects localhost and private-network service dependencies", () => {
  const errors = validateProductionServiceUrls(
    ["EMBEDDING_API_URL", "RECOMMENDATION_API_URL"],
    {
      APP_ENV: "production",
      NODE_ENV: "production",
      EMBEDDING_API_URL: "https://localhost:8000/ai/embed",
      RECOMMENDATION_API_URL: "https://192.168.1.20:8100/recommendations",
    },
  );
  assert.deepEqual(errors, [
    "EMBEDDING_API_URL must not use a local address in production",
    "RECOMMENDATION_API_URL must not use a local address in production",
  ]);
});

test("safe environment diagnostics never contain secret values", () => {
  const secret = "secret-value-that-must-not-appear";
  const summary = safeEnvironmentSummary(
    ["REMOTE_AI_API_KEY", "EMBEDDING_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    {
      REMOTE_AI_API_KEY: secret,
      EMBEDDING_API_KEY: secret,
      SUPABASE_SERVICE_ROLE_KEY: secret,
    },
  );
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.deepEqual(summary, {
    REMOTE_AI_API_KEY: "configured",
    EMBEDDING_API_KEY: "configured",
    SUPABASE_SERVICE_ROLE_KEY: "configured",
  });
});
