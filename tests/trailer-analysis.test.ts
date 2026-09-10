import assert from "node:assert/strict";
import test from "node:test";

import {
  TrailerReportError,
  analyzeTrailerReport,
  filterApplyCandidates,
  loadTrailerReport,
  type TrailerEnrichmentReport,
} from "../scripts/analyze-trailer-report";

const sampleReport: TrailerEnrichmentReport = {
  generated_at: "2026-09-10T00:00:00.000Z",
  results: [
    {
      content_id: 1,
      title: "Direct Movie",
      source: "TMDB",
      matched_provider: "TMDB:movie:1",
      trailer_url: "https://www.youtube.com/watch?v=direct",
      confidence: 1,
      action: "would_update",
    },
    {
      content_id: 2,
      title: "Exact Anime",
      source: "MAL",
      matched_provider: "TMDB:tv:2",
      trailer_url: "https://www.youtube.com/watch?v=exact",
      confidence: 0.93,
      action: "would_update",
    },
    {
      content_id: 3,
      title: "Alternative Anime",
      source: "MAL",
      matched_provider: "TMDB:tv:3",
      trailer_url: "https://www.youtube.com/watch?v=alternative",
      confidence: 0.87,
      action: "would_update",
    },
    {
      content_id: 4,
      title: "No Match",
      source: "TMDB",
      matched_provider: null,
      trailer_url: null,
      confidence: 0,
      action: "unmatched",
    },
    {
      content_id: 5,
      title: "Duplicate Video",
      source: "OTHER",
      matched_provider: "TMDB:movie:5",
      trailer_url: "https://www.youtube.com/watch?v=direct",
      confidence: 0.98,
      action: "skipped",
      content_type: "documentary",
    },
  ],
};

test("report loading can be mocked without filesystem access", async () => {
  const report = await loadTrailerReport("mock-report.json", async (path, encoding) => {
    assert.equal(path, "mock-report.json");
    assert.equal(encoding, "utf8");
    return JSON.stringify(sampleReport);
  });
  assert.equal(report.results.length, 5);
});

test("missing and malformed reports return readable errors", async () => {
  await assert.rejects(
    loadTrailerReport("missing.json", async () => {
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }),
    (error: unknown) => error instanceof TrailerReportError && /not found/.test(error.message),
  );

  await assert.rejects(
    loadTrailerReport("invalid.json", async () => "{invalid-json"),
    (error: unknown) => error instanceof TrailerReportError && /invalid JSON/.test(error.message),
  );
});

test("empty result reports produce zero-valued analysis", () => {
  const { analysis, candidates } = analyzeTrailerReport({ results: [] }, "2026-09-10T00:00:00.000Z");
  assert.equal(analysis.total_results, 0);
  assert.deepEqual(analysis.confidence_groups, { high: 0, medium: 0, low: 0, failed: 0 });
  assert.deepEqual(candidates, []);
});

test("confidence, action, source, type, and risk groups are calculated", () => {
  const { analysis } = analyzeTrailerReport(sampleReport, "2026-09-10T00:00:00.000Z");
  assert.deepEqual(analysis.confidence_groups, { high: 2, medium: 1, low: 1, failed: 1 });
  assert.deepEqual(analysis.action_distribution, { would_update: 3, unmatched: 1, skipped: 1 });
  assert.deepEqual(analysis.source_distribution, { TMDB: 2, MAL: 2, other: 1 });
  assert.deepEqual(analysis.content_type_distribution, {
    anime: 2,
    movie: 1,
    series: 0,
    documentary: 1,
    unknown: 1,
  });
  assert.deepEqual(analysis.risk_classification, { safe_apply: 1, manual_review: 2, reject_review: 1 });
});

test("candidate filtering includes only actionable confidence at or above 0.95", () => {
  const candidates = filterApplyCandidates(sampleReport.results);
  assert.deepEqual(candidates, [{
    content_id: 1,
    title: "Direct Movie",
    trailer_url: "https://www.youtube.com/watch?v=direct",
    confidence: 1,
    source: "TMDB",
    matched_provider: "TMDB:movie:1",
  }]);
});
