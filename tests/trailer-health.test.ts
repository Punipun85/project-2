import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrailerHealthReport,
  runTrailerHealthAudit,
  type EnrichmentHistory,
  type TrailerHealthConfig,
  type TrailerHealthContent,
  type TrailerHealthReport,
} from "../scripts/audit-trailer-health";

const enrichment: EnrichmentHistory = {
  tmdb_applied: 136,
  jikan_candidates: 65,
  jikan_applied: 0,
  jikan_apply_status: "not_run",
};

const contents: TrailerHealthContent[] = [
  { id: 1, source: "TMDB", content_type: "movie", trailer_url: "https://www.youtube.com/watch?v=shared123" },
  { id: 2, source: "TMDB", content_type: "series", series_type: "kdrama", trailer_url: null },
  { id: 3, source: "MAL", content_type: "anime", series_type: "anime_series", trailer_url: "https://youtu.be/shared123" },
  { id: 4, source: "MAL", content_type: "anime", series_type: "anime_movie", trailer_url: "http://youtube.com/watch?v=unsafe123" },
  { id: 5, source: "OTHER", content_type: "documentary", trailer_url: null },
];

test("calculates overall trailer coverage", () => {
  const report = buildTrailerHealthReport(contents, enrichment, "2026-09-10T00:00:00.000Z");
  assert.equal(report.total_contents, 5);
  assert.equal(report.with_trailer, 3);
  assert.equal(report.without_trailer, 2);
  assert.equal(report.coverage_percentage, 60);
});

test("groups coverage by source, content type, and series type", () => {
  const report = buildTrailerHealthReport(contents, enrichment);
  assert.deepEqual(report.by_source.TMDB, {
    total: 2,
    with_trailer: 1,
    without_trailer: 1,
    coverage_percentage: 50,
  });
  assert.equal(report.by_source.MAL.total, 2);
  assert.equal(report.by_source.MAL.coverage_percentage, 100);
  assert.equal(report.by_type.anime.total, 2);
  assert.equal(report.by_type.movie.with_trailer, 1);
  assert.equal(report.by_type.series.without_trailer, 1);
  assert.equal(report.by_series_type.kdrama.without_trailer, 1);
});

test("detects invalid non-HTTPS trailer URLs", () => {
  const report = buildTrailerHealthReport(contents, enrichment);
  assert.equal(report.validation.invalid_urls, 1);
});

test("detects duplicate trailers across equivalent YouTube URL forms", () => {
  const report = buildTrailerHealthReport(contents, enrichment);
  assert.equal(report.validation.duplicate_urls, 1);
});

test("runtime audit mocks Supabase GET and local enrichment reports", async () => {
  const config: TrailerHealthConfig = {
    supabaseUrl: "https://supabase.example",
    supabaseServiceRoleKey: "test-only-service-role",
    timeoutMs: 1_000,
    maxRetries: 1,
    reportPath: "unused-in-tests.json",
  };
  let written: TrailerHealthReport | undefined;
  const methods: string[] = [];

  const report = await runTrailerHealthAudit({
    config,
    fetchImplementation: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "supabase.example");
      assert.equal(url.searchParams.get("select"), "id,source,content_type,series_type,trailer_url");
      methods.push(init?.method ?? "GET");
      return Response.json(contents);
    },
    readReport: async (path) => {
      if (path.endsWith("trailer-apply-result.json") && !path.includes("jikan")) {
        return JSON.stringify({ updated: 136 });
      }
      if (path.endsWith("jikan-trailer-enrichment-report.json")) {
        return JSON.stringify({ results: Array.from({ length: 65 }, (_, index) => ({
          content_id: index + 1,
          confidence: 1,
          action: "would_update",
        })) });
      }
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
    writeReport: async (value) => { written = structuredClone(value); },
    sleep: async () => undefined,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  });

  assert.deepEqual(methods, ["GET"]);
  assert.equal(report.enrichment.tmdb_applied, 136);
  assert.equal(report.enrichment.jikan_candidates, 65);
  assert.equal(report.enrichment.jikan_applied, 0);
  assert.equal(report.enrichment.jikan_apply_status, "not_run");
  assert.equal(written?.coverage_percentage, 60);
});
