import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateMatchConfidence,
  isRejectedTrailerTitle,
  normalizeTitle,
  runTrailerEnrichment,
  selectTrailer,
  type ContentCandidate,
  type EnrichmentReport,
  type TrailerEnrichmentConfig,
} from "../scripts/enrich-trailers";

const config: TrailerEnrichmentConfig = {
  supabaseUrl: "https://supabase.example",
  supabaseServiceRoleKey: "test-service-role-key",
  tmdbApiKey: "test-tmdb-key",
  timeoutMs: 1_000,
  maxRetries: 1,
  requestDelayMs: 0,
  reportPath: "unused-in-tests.json",
};

const interstellar: ContentCandidate = {
  id: 10,
  external_id: "157336",
  source: "TMDB",
  content_type: "movie",
  series_type: null,
  title: "Interstellar",
  original_title: "Interstellar",
  alternative_titles: ["Interstellar (2014)"],
  release_year: 2014,
  popularity_score: 98.4,
  rating_average: 8.7,
};

test("title normalization is deterministic across punctuation and accents", () => {
  assert.equal(normalizeTitle("  Shingeki no Kyojin: The Final Season! "), "shingeki no kyojin the final season");
  assert.equal(normalizeTitle("Pokémon & Friends"), "pokemon and friends");
});

test("trailer title rejection blocks fan, clip, and gameplay videos", () => {
  assert.equal(isRejectedTrailerTitle("Official Trailer"), false);
  assert.equal(isRejectedTrailerTitle("Fan-Made Concept Trailer"), true);
  assert.equal(isRejectedTrailerTitle("Best Scene Clip"), true);
  assert.equal(isRejectedTrailerTitle("Official Gameplay Trailer"), true);

  const selected = selectTrailer([
    { site: "YouTube", key: "fan", type: "Trailer", official: true, name: "Fan Trailer" },
    { site: "YouTube", key: "official", type: "Trailer", official: true, name: "Official Trailer" },
  ], 1);
  assert.equal(selected?.videoId, "official");
});

test("confidence calculation distinguishes primary and alternative title matches", () => {
  assert.equal(calculateMatchConfidence(interstellar, {
    id: 157336,
    title: "Interstellar",
    release_date: "2014-11-05",
  }), 0.97);

  assert.equal(calculateMatchConfidence({
    ...interstellar,
    title: "Attack on Titan",
    original_title: "Shingeki no Kyojin",
    alternative_titles: ["AoT"],
    release_year: 2013,
  }, {
    id: 1429,
    name: "Shingeki no Kyojin",
    first_air_date: "2013-04-07",
  }), 0.89);

  assert.equal(calculateMatchConfidence(interstellar, {
    id: 1,
    title: "Interstellar",
    release_date: "1998-01-01",
  }), 0.8);
});

test("duplicate content and duplicate selected videos are skipped", async () => {
  const rows = [
    interstellar,
    { ...interstellar },
    { ...interstellar, id: 11, external_id: "999", title: "Another Film" },
  ];
  const reports: EnrichmentReport[] = [];

  const report = await runTrailerEnrichment({
    mode: "dry-run",
    config,
    fetchImplementation: createFetchMock(rows, {
      "157336": "shared-video",
      "999": "shared-video",
    }).fetchImplementation,
    sleep: async () => undefined,
    log: () => undefined,
    writeReport: async (value) => { reports.push(structuredClone(value)); },
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  });

  assert.equal(report.total_checked, 3);
  assert.equal(report.matched, 1);
  assert.equal(report.skipped, 2);
  assert.deepEqual(report.results.map((item) => item.action), ["would_update", "skipped", "skipped"]);
  assert.ok(reports.length >= 1);
});

test("dry-run mocks TMDB and Supabase without sending a database update", async () => {
  const mock = createFetchMock([interstellar], { "157336": "zSWdZVtXT7E" });
  let writtenReport: EnrichmentReport | undefined;

  const report = await runTrailerEnrichment({
    config,
    fetchImplementation: mock.fetchImplementation,
    sleep: async () => undefined,
    log: () => undefined,
    writeReport: async (value) => { writtenReport = structuredClone(value); },
  });

  assert.equal(report.matched, 1);
  assert.equal(report.applied, 0);
  assert.equal(report.results[0].action, "would_update");
  assert.equal(mock.patchCalls(), 0);
  assert.equal(writtenReport?.results[0].trailer_url, "https://www.youtube.com/watch?v=zSWdZVtXT7E");
});

function createFetchMock(
  rows: ContentCandidate[],
  videosByExternalId: Record<string, string>,
): { fetchImplementation: typeof fetch; patchCalls: () => number } {
  let patches = 0;
  return {
    patchCalls: () => patches,
    fetchImplementation: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "supabase.example") {
        if (init?.method === "PATCH") {
          patches += 1;
          return Response.json([{ id: url.searchParams.get("id")?.replace("eq.", "") }]);
        }
        return Response.json(rows);
      }
      if (url.hostname === "api.themoviedb.org") {
        const match = url.pathname.match(/\/(?:movie|tv)\/(\d+)\/videos$/);
        if (!match) return Response.json({ results: [] });
        const videoId = videosByExternalId[match[1]];
        return Response.json({
          results: videoId
            ? [{ site: "YouTube", key: videoId, type: "Trailer", official: true, name: "Official Trailer" }]
            : [],
        });
      }
      throw new Error(`Unexpected mocked request: ${url}`);
    },
  };
}
