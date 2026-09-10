import assert from "node:assert/strict";
import test from "node:test";

import { analyzeJikanTrailerReport } from "../scripts/analyze-jikan-trailer-report";
import {
  assertDryRunOnly,
  extractJikanTrailer,
  runJikanTrailerEnrichment,
  sortMalTrailerCandidates,
  type JikanEnrichmentConfig,
  type JikanTrailerReport,
  type MalTrailerCandidate,
} from "../scripts/enrich-jikan-trailers";

const config: JikanEnrichmentConfig = {
  supabaseUrl: "https://supabase.example",
  supabaseServiceRoleKey: "test-only-service-role",
  jikanBaseUrl: "https://jikan.example/v4",
  timeoutMs: 1_000,
  maxRetries: 1,
  requestDelayMs: 0,
  reportPath: "unused-in-tests.json",
};

const anime: MalTrailerCandidate = {
  id: 1,
  external_id: "16498",
  title: "Attack on Titan",
  original_title: "Shingeki no Kyojin",
  popularity_score: 100,
  rating_average: 8.6,
  content_type: "anime",
};

test("extracts and canonicalizes provider-designated YouTube trailers", () => {
  assert.equal(
    extractJikanTrailer({ embed_url: "https://www.youtube.com/embed/zSWdZVtXT7E" }),
    "https://www.youtube.com/watch?v=zSWdZVtXT7E",
  );
  assert.equal(
    extractJikanTrailer({ youtube_id: "abcDEF_1234" }),
    "https://www.youtube.com/watch?v=abcDEF_1234",
  );
  assert.equal(extractJikanTrailer({ url: "https://example.com/video" }), null);
});

test("rejects AMV, clip, episode, fan-made, reaction, and gameplay metadata", () => {
  for (const title of ["Official AMV", "Episode 1", "Anime Clip", "Fan-Made Trailer", "Reaction", "Gameplay"]) {
    assert.equal(extractJikanTrailer({ youtube_id: "abcDEF_1234", title }), null);
  }
});

test("orders MAL candidates by popularity, rating, then canonical id", () => {
  const ordered = sortMalTrailerCandidates([
    { ...anime, id: 3, popularity_score: 10, rating_average: 9 },
    { ...anime, id: 2, popularity_score: 20, rating_average: 8 },
    { ...anime, id: 1, popularity_score: 20, rating_average: 8 },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), [1, 2, 3]);
});

test("dry-run uses GET only and never updates Supabase", async () => {
  const methods: string[] = [];
  let written: JikanTrailerReport | undefined;
  const report = await runJikanTrailerEnrichment({
    config,
    fetchImplementation: async (input, init) => {
      methods.push(init?.method ?? "GET");
      const url = new URL(String(input));
      if (url.hostname === "supabase.example") return Response.json([anime]);
      if (url.hostname === "jikan.example") {
        assert.equal(url.pathname, "/v4/anime/16498/full");
        return Response.json({ data: { trailer: { youtube_id: "zSWdZVtXT7E" } } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    sleep: async () => undefined,
    log: () => undefined,
    writeReport: async (value) => { written = structuredClone(value); },
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  });

  assert.deepEqual(methods, ["GET", "GET"]);
  assert.equal(report.checked, 1);
  assert.equal(report.matched, 1);
  assert.equal(report.results[0].action, "would_update");
  assert.equal(written?.results[0].confidence, 1);
});

test("single Jikan failure is recorded and later records continue", async () => {
  const second = { ...anime, id: 2, external_id: "52991", title: "Frieren" };
  const report = await runJikanTrailerEnrichment({
    config,
    fetchImplementation: async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "supabase.example") return Response.json([anime, second]);
      if (url.pathname.includes("/16498/")) return Response.json({ message: "failure" }, { status: 500 });
      return Response.json({ data: { trailer: { youtube_id: "frieren_123" } } });
    },
    sleep: async () => undefined,
    log: () => undefined,
    writeReport: async () => undefined,
  });

  assert.equal(report.skipped, 1);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.results.map((item) => item.action), ["error", "would_update"]);
});

test("analyzer validates report totals and safe candidates", () => {
  const analysis = analyzeJikanTrailerReport({
    generated_at: "2026-09-10T00:00:00.000Z",
    checked: 2,
    matched: 1,
    unmatched: 1,
    skipped: 0,
    results: [
      { content_id: 1, title: "Matched", mal_id: "1", trailer_url: "https://www.youtube.com/watch?v=abcdef", confidence: 1, action: "would_update" },
      { content_id: 2, title: "Missing", mal_id: "2", trailer_url: null, confidence: 0, action: "unmatched" },
    ],
  }, "2026-09-10T01:00:00.000Z");

  assert.equal(analysis.safe_candidates, 1);
  assert.equal(analysis.confidence_distribution.confirmed, 1);
  assert.equal(analysis.confidence_distribution.unavailable, 1);
  assert.equal(analysis.report_consistent, true);
});

test("apply flags are explicitly rejected", () => {
  assert.doesNotThrow(() => assertDryRunOnly([]));
  assert.doesNotThrow(() => assertDryRunOnly(["--dry-run"]));
  assert.throws(() => assertDryRunOnly(["--apply"]), /dry-run only/);
});
