import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireEnvironmentValue, type RuntimeEnvironment } from "../lib/env";
import type { JikanTrailerReport, JikanTrailerResult } from "./enrich-jikan-trailers";

export const DEFAULT_JIKAN_CANDIDATE_REPORT_PATH = resolve("reports", "jikan-trailer-enrichment-report.json");
export const DEFAULT_JIKAN_APPLY_RESULT_PATH = resolve("reports", "jikan-trailer-apply-result.json");

export type JikanApplyCandidate = {
  content_id: number | string;
  title: string;
  trailer_url: string;
  confidence: 1;
};

export type JikanApplyResult = {
  content_id: number | string;
  title: string;
  status: "updated" | "skipped_existing" | "failed";
  trailer_url: string;
};

export type JikanApplyReport = {
  generated_at: string;
  total_candidates: number;
  updated: number;
  skipped_existing: number;
  failed: number;
  results: JikanApplyResult[];
};

export type JikanApplyConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  timeoutMs: number;
  maxRetries: number;
  resultPath: string;
};

export type JikanApplyOptions = {
  config: JikanApplyConfig;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  writeReport?: (report: JikanApplyReport) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export class JikanApplyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JikanApplyError";
  }
}

export function createJikanApplyConfig(environment: RuntimeEnvironment = process.env): JikanApplyConfig {
  return {
    supabaseUrl: requireEnvironmentValue("SUPABASE_URL", environment).replace(/\/$/, ""),
    supabaseServiceRoleKey: requireEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY", environment),
    timeoutMs: 10_000,
    maxRetries: 4,
    resultPath: DEFAULT_JIKAN_APPLY_RESULT_PATH,
  };
}

export async function loadJikanApplyCandidates(
  path = DEFAULT_JIKAN_CANDIDATE_REPORT_PATH,
  read: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<JikanApplyCandidate[]> {
  let raw: string;
  try {
    raw = await read(path, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") throw new JikanApplyError(`Jikan trailer report not found: ${path}`, { cause: error });
    throw new JikanApplyError(`Could not read Jikan trailer report: ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new JikanApplyError(`Jikan trailer report contains invalid JSON: ${path}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { results?: unknown }).results)) {
    throw new JikanApplyError("Jikan trailer report must contain a results array");
  }
  return selectJikanApplyCandidates(parsed as JikanTrailerReport);
}

export function selectJikanApplyCandidates(report: Pick<JikanTrailerReport, "results">): JikanApplyCandidate[] {
  const candidates: JikanApplyCandidate[] = [];
  const seenContentIds = new Set<string>();
  for (const [index, result] of report.results.entries()) {
    if (!isCandidateResult(result)) continue;
    const contentId = String(result.content_id ?? "").trim();
    const title = String(result.title ?? "").trim();
    const trailerUrl = String(result.trailer_url ?? "").trim();
    if (!contentId || !title || !isSafeYouTubeUrl(trailerUrl)) {
      throw new JikanApplyError(`Invalid safe candidate at report result index ${index}`);
    }
    if (seenContentIds.has(contentId)) {
      throw new JikanApplyError(`Duplicate content_id in Jikan candidate report: ${contentId}`);
    }
    seenContentIds.add(contentId);
    candidates.push({
      content_id: result.content_id,
      title,
      trailer_url: trailerUrl,
      confidence: 1,
    });
  }
  return candidates;
}

function isCandidateResult(result: JikanTrailerResult): boolean {
  return result.action === "would_update"
    && result.confidence === 1
    && typeof result.trailer_url === "string"
    && Boolean(result.trailer_url.trim());
}

function isSafeYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(hostname)) return false;
    const videoId = hostname === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v");
    return Boolean(videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId));
  } catch {
    return false;
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function defaultLog(entry: Record<string, unknown>): void {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
}

class SupabaseJsonClient {
  constructor(
    private readonly fetchImplementation: typeof fetch,
    private readonly config: JikanApplyConfig,
    private readonly sleep: (milliseconds: number) => Promise<void>,
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.fetchImplementation(`${this.config.supabaseUrl}/rest/v1/${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            apikey: this.config.supabaseServiceRoleKey,
            authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
            "content-type": "application/json",
            ...init.headers,
          },
        });
        if (!response.ok) {
          const error = new Error(`Supabase request failed with HTTP ${response.status}`);
          if (!RETRYABLE_STATUS.has(response.status) || attempt === this.config.maxRetries) throw error;
          await this.sleep(retryDelay(response.headers.get("retry-after"), attempt));
          continue;
        }
        return response.status === 204 ? undefined as T : await response.json() as T;
      } catch (error) {
        lastError = error;
        if (attempt === this.config.maxRetries || !isRetryableNetworkError(error)) throw error;
        await this.sleep(retryDelay(null, attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Supabase request failed");
  }
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1_000, 0), 30_000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 30_000);
  }
  return Math.min(500 * 2 ** (attempt - 1), 10_000);
}

async function readCurrentContent(
  candidate: JikanApplyCandidate,
  client: SupabaseJsonClient,
): Promise<{ found: boolean; source: string | null; trailerUrl: string | null }> {
  const query = new URLSearchParams({
    select: "id,source,trailer_url",
    id: `eq.${candidate.content_id}`,
    limit: "1",
  });
  const rows = await client.request<Array<{ id: number | string; source: string | null; trailer_url: string | null }>>(
    `contents?${query}`,
  );
  const row = rows[0];
  return row
    ? { found: true, source: row.source, trailerUrl: row.trailer_url }
    : { found: false, source: null, trailerUrl: null };
}

async function guardedUpdate(
  candidate: JikanApplyCandidate,
  client: SupabaseJsonClient,
): Promise<boolean> {
  const query = new URLSearchParams({
    id: `eq.${candidate.content_id}`,
    source: "eq.MAL",
    trailer_url: "is.null",
    select: "id,trailer_url",
  });
  const rows = await client.request<Array<{ id: number | string; trailer_url: string }>>(`contents?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ trailer_url: candidate.trailer_url }),
  });
  return rows.length === 1;
}

async function writeJsonAtomic(path: string, report: JikanApplyReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function applyJikanTrailerCandidates(
  candidates: JikanApplyCandidate[],
  options: JikanApplyOptions,
): Promise<JikanApplyReport> {
  const validated = validateCandidates(candidates);
  const log = options.log ?? defaultLog;
  const persistReport = options.writeReport
    ?? ((report: JikanApplyReport) => writeJsonAtomic(options.config.resultPath, report));
  const client = new SupabaseJsonClient(
    options.fetchImplementation ?? fetch,
    options.config,
    options.sleep ?? defaultSleep,
  );
  const report: JikanApplyReport = {
    generated_at: (options.now ?? (() => new Date()))().toISOString(),
    total_candidates: validated.length,
    updated: 0,
    skipped_existing: 0,
    failed: 0,
    results: [],
  };

  log({ level: "info", event: "jikan_trailer_apply_started", total_candidates: validated.length });
  for (const candidate of validated) {
    try {
      const current = await readCurrentContent(candidate, client);
      if (!current.found) throw new Error("Content record not found");
      if (String(current.source ?? "").toLocaleUpperCase("en-US") !== "MAL") {
        throw new Error("Content source is not MAL");
      }
      if (current.trailerUrl !== null) {
        report.skipped_existing += 1;
        report.results.push(toResult(candidate, "skipped_existing"));
      } else if (await guardedUpdate(candidate, client)) {
        report.updated += 1;
        report.results.push(toResult(candidate, "updated"));
      } else {
        // A concurrent update after the pre-check is treated as a safe skip.
        report.skipped_existing += 1;
        report.results.push(toResult(candidate, "skipped_existing"));
      }
    } catch (error) {
      report.failed += 1;
      report.results.push(toResult(candidate, "failed"));
      log({
        level: "error",
        event: "jikan_trailer_apply_failed",
        content_id: String(candidate.content_id),
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
    }
    await persistReport(report);
    log({
      level: "info",
      event: "jikan_trailer_apply_record_complete",
      content_id: String(candidate.content_id),
      status: report.results.at(-1)?.status,
    });
  }

  await persistReport(report);
  log({
    level: "info",
    event: "jikan_trailer_apply_complete",
    total_candidates: report.total_candidates,
    updated: report.updated,
    skipped_existing: report.skipped_existing,
    failed: report.failed,
  });
  return report;
}

function validateCandidates(candidates: JikanApplyCandidate[]): JikanApplyCandidate[] {
  const syntheticReport = { results: candidates.map((candidate) => ({
    ...candidate,
    mal_id: "validated-upstream",
    action: "would_update" as const,
  })) };
  return selectJikanApplyCandidates(syntheticReport);
}

function toResult(candidate: JikanApplyCandidate, status: JikanApplyResult["status"]): JikanApplyResult {
  return {
    content_id: candidate.content_id,
    title: candidate.title,
    status,
    trailer_url: candidate.trailer_url,
  };
}

async function main(): Promise<void> {
  const candidates = await loadJikanApplyCandidates();
  await applyJikanTrailerCandidates(candidates, { config: createJikanApplyConfig() });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Jikan trailer candidate apply failed");
    process.exitCode = 1;
  });
}
