import assert from "node:assert/strict";
import test from "node:test";

import { GET as adminDashboard } from "../app/api/admin/dashboard/route";
import { validateProductionEnvironment } from "../lib/production-config";
import { checkRateLimit } from "../lib/security/rate-limit";

test("production environment validation accepts optional service integrations", () => {
  const result = validateProductionEnvironment({
    APP_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://app.example.com",
    SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon",
    EMBEDDING_API_URL: "https://embed.test/ai/embed", EMBEDDING_API_KEY: "key",
    EMBEDDING_MODEL: "sentence-transformers/all-MiniLM-L6-v2",
    REMOTE_AI_BASE_URL: "https://ai.example.com/v1", REMOTE_AI_API_KEY: "ai-key",
    REMOTE_AI_DEFAULT_MODEL: "default", REMOTE_AI_REASONING_MODEL: "reasoning",
    REMOTE_AI_FALLBACK_MODEL: "fallback",
    RECOMMENDATION_API_URL: "", RECOMMENDATION_API_KEY: "",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.missing, []);
});

test("rate limiter rejects requests after the configured allowance", () => {
  const key = `test-${Math.random()}`;
  assert.equal(checkRateLimit(key, 2, 60_000, 1).allowed, true);
  assert.equal(checkRateLimit(key, 2, 60_000, 2).allowed, true);
  assert.equal(checkRateLimit(key, 2, 60_000, 3).allowed, false);
});

test("admin endpoint denies an authenticated user without admin app_metadata", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json({ id: "user-1", email: "user@example.com" });
    if (url.includes("rpc/is_catalog_admin")) return Response.json(false);
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await adminDashboard(new Request("https://app.test/api/admin/dashboard", { headers: { cookie: "nexaplay_access_token=session-token" } }));
    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = originalKey;
  }
});

test("admin endpoint returns analytics for an authenticated admin", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json({ id: "admin-1", email: "admin@example.com" });
    if (url.includes("rpc/is_catalog_admin")) return Response.json(true);
    if (url.includes("rpc/get_admin_dashboard")) return Response.json({ summary: { totalUsers: 12 }, services: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await adminDashboard(new Request("https://app.test/api/admin/dashboard", { headers: { cookie: "nexaplay_access_token=session-token" } }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.summary.totalUsers, 12);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = originalKey;
  }
});
