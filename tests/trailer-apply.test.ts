import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTrailerCandidates,
  type TrailerApplyCandidate,
  type TrailerApplyConfig,
} from "../scripts/apply-trailer-candidates";

const config: TrailerApplyConfig = {
  supabaseUrl: "https://supabase.example",
  supabaseServiceRoleKey: "test-only-service-role",
  timeoutMs: 1_000,
  maxRetries: 1,
  resultPath: "unused-in-tests.json",
};

const candidate: TrailerApplyCandidate = {
  content_id: 10,
  title: "Interstellar",
  trailer_url: "https://www.youtube.com/watch?v=zSWdZVtXT7E",
  confidence: 1,
  source: "TMDB",
  matched_provider: "TMDB:movie:157336",
};

test("updates a content record only when trailer_url is null", async () => {
  let patchBody: unknown;
  const report = await applyTrailerCandidates([candidate], testOptions(async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "PATCH") {
      assert.equal(url.searchParams.get("trailer_url"), "is.null");
      patchBody = JSON.parse(String(init.body));
      return Response.json([{ id: 10, trailer_url: candidate.trailer_url }]);
    }
    return Response.json([{ id: 10, trailer_url: null }]);
  }));

  assert.equal(report.updated, 1);
  assert.equal(report.failed, 0);
  assert.deepEqual(patchBody, { trailer_url: candidate.trailer_url });
  assert.equal(report.results[0].status, "updated");
});

test("skips a record with an existing trailer without sending PATCH", async () => {
  let patchCalls = 0;
  const report = await applyTrailerCandidates([candidate], testOptions(async (_input, init) => {
    if (init?.method === "PATCH") patchCalls += 1;
    return Response.json([{ id: 10, trailer_url: "https://www.youtube.com/watch?v=existing" }]);
  }));

  assert.equal(report.skipped_existing, 1);
  assert.equal(patchCalls, 0);
  assert.equal(report.results[0].status, "skipped_existing");
});

test("continues sequentially after one failed update", async () => {
  const second = { ...candidate, content_id: 11, title: "Second Movie", trailer_url: "https://youtu.be/second" };
  const events: string[] = [];
  const report = await applyTrailerCandidates([candidate, second], testOptions(async (input, init) => {
    const url = new URL(String(input));
    const id = url.searchParams.get("id")?.replace("eq.", "");
    events.push(`${init?.method ?? "GET"}:${id}`);
    if (init?.method !== "PATCH") return Response.json([{ id, trailer_url: null }]);
    if (id === "10") return Response.json({ message: "provider error" }, { status: 500 });
    return Response.json([{ id: 11, trailer_url: second.trailer_url }]);
  }));

  assert.equal(report.failed, 1);
  assert.equal(report.updated, 1);
  assert.deepEqual(report.results.map((result) => result.status), ["failed", "updated"]);
  assert.deepEqual(events, ["GET:10", "PATCH:10", "GET:11", "PATCH:11"]);
});

test("a guarded update race never overwrites an existing trailer", async () => {
  let guardedFilter: string | null = null;
  let updateBody: Record<string, unknown> | undefined;
  const report = await applyTrailerCandidates([candidate], testOptions(async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "PATCH") {
      guardedFilter = url.searchParams.get("trailer_url");
      updateBody = JSON.parse(String(init.body));
      return Response.json([]);
    }
    return Response.json([{ id: 10, trailer_url: null }]);
  }));

  assert.equal(guardedFilter, "is.null");
  assert.deepEqual(updateBody, { trailer_url: candidate.trailer_url });
  assert.equal(report.updated, 0);
  assert.equal(report.skipped_existing, 1);
  assert.equal(report.results[0].status, "skipped_existing");
});

function testOptions(fetchImplementation: typeof fetch) {
  return {
    config,
    fetchImplementation,
    sleep: async () => undefined,
    log: () => undefined,
    writeReport: async () => undefined,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  };
}
