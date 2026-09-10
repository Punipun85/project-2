import assert from "node:assert/strict";
import test from "node:test";

import {
  applyJikanTrailerCandidates,
  selectJikanApplyCandidates,
  type JikanApplyCandidate,
  type JikanApplyConfig,
} from "../scripts/apply-jikan-trailer-candidates";
import type { JikanTrailerReport } from "../scripts/enrich-jikan-trailers";

const config: JikanApplyConfig = {
  supabaseUrl: "https://supabase.example",
  supabaseServiceRoleKey: "test-only-service-role",
  timeoutMs: 1_000,
  maxRetries: 1,
  resultPath: "unused-in-tests.json",
};

const candidate: JikanApplyCandidate = {
  content_id: 10,
  title: "Attack on Titan",
  trailer_url: "https://www.youtube.com/watch?v=zSWdZVtXT7E",
  confidence: 1,
};

test("selects only confidence-1 would_update records from the Jikan report", () => {
  const report: JikanTrailerReport = {
    generated_at: "2026-09-10T00:00:00.000Z",
    checked: 4,
    matched: 1,
    unmatched: 1,
    skipped: 2,
    results: [
      { ...candidate, mal_id: "16498", action: "would_update" },
      { ...candidate, content_id: 11, mal_id: "11", confidence: 0, action: "unmatched", trailer_url: null },
      { ...candidate, content_id: 12, mal_id: "12", action: "skipped" },
      { ...candidate, content_id: 13, mal_id: "13", confidence: 0, action: "error", trailer_url: null },
    ],
  };
  assert.deepEqual(selectJikanApplyCandidates(report), [candidate]);
});

test("updates only trailer_url for a null MAL record with a guarded query", async () => {
  let patchBody: unknown;
  let patchSourceFilter: string | null = null;
  let patchTrailerFilter: string | null = null;
  const report = await applyJikanTrailerCandidates([candidate], options(async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "PATCH") {
      patchBody = JSON.parse(String(init.body));
      patchSourceFilter = url.searchParams.get("source");
      patchTrailerFilter = url.searchParams.get("trailer_url");
      return Response.json([{ id: 10, trailer_url: candidate.trailer_url }]);
    }
    return Response.json([{ id: 10, source: "MAL", trailer_url: null }]);
  }));

  assert.equal(report.updated, 1);
  assert.deepEqual(patchBody, { trailer_url: candidate.trailer_url });
  assert.equal(patchSourceFilter, "eq.MAL");
  assert.equal(patchTrailerFilter, "is.null");
});

test("skips an existing trailer and never sends an update", async () => {
  let patchCalls = 0;
  const report = await applyJikanTrailerCandidates([candidate], options(async (_input, init) => {
    if (init?.method === "PATCH") patchCalls += 1;
    return Response.json([{ id: 10, source: "MAL", trailer_url: "https://www.youtube.com/watch?v=existing" }]);
  }));

  assert.equal(report.skipped_existing, 1);
  assert.equal(patchCalls, 0);
});

test("rejects a non-MAL database row without updating it", async () => {
  let patchCalls = 0;
  const report = await applyJikanTrailerCandidates([candidate], options(async (_input, init) => {
    if (init?.method === "PATCH") patchCalls += 1;
    return Response.json([{ id: 10, source: "TMDB", trailer_url: null }]);
  }));

  assert.equal(report.failed, 1);
  assert.equal(patchCalls, 0);
  assert.equal(report.results[0].status, "failed");
});

test("continues sequentially after a transient update failure", async () => {
  const second: JikanApplyCandidate = {
    ...candidate,
    content_id: 11,
    title: "Frieren",
    trailer_url: "https://youtu.be/frieren_123",
  };
  const events: string[] = [];
  const report = await applyJikanTrailerCandidates([candidate, second], options(async (input, init) => {
    const url = new URL(String(input));
    const id = url.searchParams.get("id")?.replace("eq.", "");
    events.push(`${init?.method ?? "GET"}:${id}`);
    if (init?.method !== "PATCH") return Response.json([{ id, source: "MAL", trailer_url: null }]);
    if (id === "10") return Response.json({ message: "temporary failure" }, { status: 503 });
    return Response.json([{ id: 11, trailer_url: second.trailer_url }]);
  }));

  assert.equal(report.failed, 1);
  assert.equal(report.updated, 1);
  assert.deepEqual(report.results.map((result) => result.status), ["failed", "updated"]);
  assert.deepEqual(events, ["GET:10", "PATCH:10", "GET:11", "PATCH:11"]);
});

test("an empty guarded PATCH is treated as a race-safe existing skip", async () => {
  const report = await applyJikanTrailerCandidates([candidate], options(async (_input, init) => {
    if (init?.method === "PATCH") return Response.json([]);
    return Response.json([{ id: 10, source: "MAL", trailer_url: null }]);
  }));
  assert.equal(report.updated, 0);
  assert.equal(report.skipped_existing, 1);
});

function options(fetchImplementation: typeof fetch) {
  return {
    config,
    fetchImplementation,
    sleep: async () => undefined,
    log: () => undefined,
    writeReport: async () => undefined,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  };
}
