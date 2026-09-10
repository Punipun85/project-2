import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireEnvironmentValue, type RuntimeEnvironment } from "../lib/env";

export const DEFAULT_TRAILER_CANDIDATES_PATH = resolve("reports", "trailer-apply-candidates.json");
export const DEFAULT_TRAILER_APPLY_RESULT_PATH = resolve("reports", "trailer-apply-result.json");

export type TrailerApplyCandidate = {
  content_id: number | string;
  title: string;
  trailer_url: string;
  confidence: number;
  source?: string;
  matched_provider?: string | null;
};

export type TrailerApplyResult = {
  content_id: number | string;
  title: string;
  status: "updated" | "skipped_existing" | "failed";
  trailer_url: string;
};

export type TrailerApplyReport = {
  generated_at: string;
  total_candidates: number;
  updated: number;
  skipped_existing: number;
  failed: number;
  results: TrailerApplyResult[];
};

export type TrailerApplyConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  timeoutMs: number;
  maxRetries: number;
  resultPath: string;
};

export type TrailerApplyOptions = {
  config: TrailerApplyConfig;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  writeReport?: (report: TrailerApplyReport) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const SAFE_CONFIDENCE_THRESHOLD = 0.95;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export class TrailerCandidateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TrailerCandidateError";
  }
}

export function createTrailerApplyConfig(
  environment: RuntimeEnvironment = process.env,
): TrailerApplyConfig {
  return {
    supabaseUrl: requireEnvironmentValue("SUPABASE_URL", environment).replace(/\/$/, ""),
    supabaseServiceRoleKey: requireEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY", environment),
    timeoutMs: 10_000,
    maxRetries: 4,
    resultPath: DEFAULT_TRAILER_APPLY_RESULT_PATH,
  };
}

export async function loadTrailerCandidates(
  path = DEFAULT_TRAILER_CANDIDATES_PATH,
  read: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<TrailerApplyCandidate[]> {
  let raw: string;
  try {
    raw = await read(path, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") {
      throw new TrailerCandidateError(`Trailer apply candidate file not found: ${path}`, { cause: error });
    }
    throw new TrailerCandidateError(`Could not read trailer apply candidate file: ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TrailerCandidateError(`Trailer apply candidate file contains invalid JSON: ${path}`, { cause: error });
  }
  if (!Array.isArray(parsed)) {
    throw new TrailerCandidateError("Trailer apply candidate file must contain a JSON array");
  }
  return validateTrailerCandidates(parsed);
}

export function validateTrailerCandidates(items: unknown[]): TrailerApplyCandidate[] {
  const validated: TrailerApplyCandidate[] = [];
  const contentIds = new Set<string>();

  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") {
      throw new TrailerCandidateError(`Candidate at index ${index} must be an object`);
    }
    const value = item as Record<string, unknown>;
    const contentId = String(value.content_id ?? "").trim();
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const trailerUrl = typeof value.trailer_url === "string" ? value.trailer_url.trim() : "";
    const confidence = Number(value.confidence);

    if (!contentId || !title || !trailerUrl || !Number.isFinite(confidence)) {
      throw new TrailerCandidateError(`Candidate at index ${index} is missing content_id, title, trailer_url, or confidence`);
    }
    if (confidence < SAFE_CONFIDENCE_THRESHOLD || confidence > 1) {
      throw new TrailerCandidateError(`Candidate at index ${index} is below the safe confidence threshold`);
    }
    if (!isSafeYouTubeUrl(trailerUrl)) {
      throw new TrailerCandidateError(`Candidate at index ${index} has an invalid YouTube trailer URL`);
    }
    if (contentIds.has(contentId)) {
      throw new TrailerCandidateError(`Duplicate content_id in candidate file: ${contentId}`);
    }
    contentIds.add(contentId);
    validated.push({
      content_id: value.content_id as number | string,
      title,
      trailer_url: trailerUrl,
      confidence,
      source: typeof value.source === "string" ? value.source : undefined,
      matched_provider: typeof value.matched_provider === "string" ? value.matched_provider : null,
    });
  }
  return validated;
}

function isSafeYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && YOUTUBE_HOSTS.has(url.hostname.toLocaleLowerCase("en-US"))
      && (url.hostname === "youtu.be" ? Boolean(url.pathname.slice(1)) : Boolean(url.searchParams.get("v")));
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
    private readonly config: TrailerApplyConfig,
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

async function currentTrailer(
  candidate: TrailerApplyCandidate,
  client: SupabaseJsonClient,
): Promise<{ found: boolean; trailerUrl: string | null }> {
  const query = new URLSearchParams({
    select: "id,trailer_url",
    id: `eq.${candidate.content_id}`,
    limit: "1",
  });
  const rows = await client.request<Array<{ id: number | string; trailer_url: string | null }>>(`contents?${query}`);
  if (!rows.length) return { found: false, trailerUrl: null };
  return { found: true, trailerUrl: rows[0].trailer_url };
}

async function guardedUpdate(
  candidate: TrailerApplyCandidate,
  client: SupabaseJsonClient,
): Promise<boolean> {
  const query = new URLSearchParams({
    id: `eq.${candidate.content_id}`,
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

async function writeJsonAtomic(path: string, report: TrailerApplyReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function applyTrailerCandidates(
  candidates: TrailerApplyCandidate[],
  options: TrailerApplyOptions,
): Promise<TrailerApplyReport> {
  const safeCandidates = validateTrailerCandidates(candidates);
  const log = options.log ?? defaultLog;
  const persistReport = options.writeReport
    ?? ((report: TrailerApplyReport) => writeJsonAtomic(options.config.resultPath, report));
  const client = new SupabaseJsonClient(
    options.fetchImplementation ?? fetch,
    options.config,
    options.sleep ?? defaultSleep,
  );
  const report: TrailerApplyReport = {
    generated_at: (options.now ?? (() => new Date()))().toISOString(),
    total_candidates: safeCandidates.length,
    updated: 0,
    skipped_existing: 0,
    failed: 0,
    results: [],
  };

  log({ level: "info", event: "trailer_candidate_apply_started", total_candidates: safeCandidates.length });
  for (const candidate of safeCandidates) {
    try {
      const current = await currentTrailer(candidate, client);
      if (!current.found) throw new Error("Content record not found");

      if (current.trailerUrl !== null) {
        report.skipped_existing += 1;
        report.results.push(toResult(candidate, "skipped_existing"));
      } else {
        const updated = await guardedUpdate(candidate, client);
        if (updated) {
          report.updated += 1;
          report.results.push(toResult(candidate, "updated"));
        } else {
          // A concurrent writer may have populated the field after the pre-check.
          // The guarded PATCH prevents any overwrite, so this is a safe skip.
          report.skipped_existing += 1;
          report.results.push(toResult(candidate, "skipped_existing"));
        }
      }
    } catch (error) {
      report.failed += 1;
      report.results.push(toResult(candidate, "failed"));
      log({
        level: "error",
        event: "trailer_candidate_apply_failed",
        content_id: String(candidate.content_id),
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
    }
    await persistReport(report);
    log({
      level: "info",
      event: "trailer_candidate_apply_record_complete",
      content_id: String(candidate.content_id),
      status: report.results.at(-1)?.status,
    });
  }

  await persistReport(report);
  log({
    level: "info",
    event: "trailer_candidate_apply_complete",
    total_candidates: report.total_candidates,
    updated: report.updated,
    skipped_existing: report.skipped_existing,
    failed: report.failed,
  });
  return report;
}

function toResult(candidate: TrailerApplyCandidate, status: TrailerApplyResult["status"]): TrailerApplyResult {
  return {
    content_id: candidate.content_id,
    title: candidate.title,
    status,
    trailer_url: candidate.trailer_url,
  };
}

async function main(): Promise<void> {
  const candidates = await loadTrailerCandidates();
  await applyTrailerCandidates(candidates, { config: createTrailerApplyConfig() });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Trailer candidate apply failed");
    process.exitCode = 1;
  });
}
