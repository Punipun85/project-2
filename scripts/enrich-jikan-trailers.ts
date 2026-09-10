import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireEnvironmentValue, type RuntimeEnvironment } from "../lib/env";

export const DEFAULT_JIKAN_REPORT_PATH = resolve("reports", "jikan-trailer-enrichment-report.json");

export type MalTrailerCandidate = {
  id: number | string;
  external_id: string;
  title: string;
  original_title?: string | null;
  popularity_score?: number | null;
  rating_average?: number | null;
  content_type: string;
};

export type JikanTrailerData = {
  youtube_id?: string | null;
  url?: string | null;
  embed_url?: string | null;
  title?: string | null;
  name?: string | null;
  type?: string | null;
};

export type JikanTrailerResult = {
  content_id: number | string;
  title: string;
  mal_id: string;
  trailer_url: string | null;
  confidence: 0 | 1;
  action: "would_update" | "unmatched" | "skipped" | "error";
};

export type JikanTrailerReport = {
  generated_at: string;
  checked: number;
  matched: number;
  unmatched: number;
  skipped: number;
  results: JikanTrailerResult[];
};

export type JikanEnrichmentConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  jikanBaseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  requestDelayMs: number;
  reportPath: string;
};

export type JikanEnrichmentOptions = {
  config: JikanEnrichmentConfig;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  writeReport?: (report: JikanTrailerReport) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const REJECTED_TRAILER_TEXT = /\b(?:clips?|episodes?|amv|fan[ -]?made|fan trailer|reaction|gameplay)\b/i;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export function createJikanEnrichmentConfig(
  environment: RuntimeEnvironment = process.env,
): JikanEnrichmentConfig {
  return {
    supabaseUrl: requireEnvironmentValue("SUPABASE_URL", environment).replace(/\/$/, ""),
    supabaseServiceRoleKey: requireEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY", environment),
    jikanBaseUrl: "https://api.jikan.moe/v4",
    timeoutMs: 10_000,
    maxRetries: 4,
    // One request per second is intentionally conservative for the public Jikan API.
    requestDelayMs: 1_000,
    reportPath: DEFAULT_JIKAN_REPORT_PATH,
  };
}

export function sortMalTrailerCandidates(candidates: MalTrailerCandidate[]): MalTrailerCandidate[] {
  const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return [...candidates].sort((left, right) =>
    number(right.popularity_score) - number(left.popularity_score)
    || number(right.rating_average) - number(left.rating_average)
    || number(left.id) - number(right.id),
  );
}

export function extractJikanTrailer(trailer: JikanTrailerData | null | undefined): string | null {
  if (!trailer || typeof trailer !== "object") return null;
  const descriptiveText = [trailer.title, trailer.name, trailer.type]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (REJECTED_TRAILER_TEXT.test(descriptiveText)) return null;

  const directCandidates = [trailer.url, trailer.embed_url]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  for (const candidate of directCandidates) {
    const videoId = youtubeVideoId(candidate);
    if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  const youtubeId = String(trailer.youtube_id ?? "").trim();
  return isYouTubeVideoId(youtubeId)
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`
    : null;
}

function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(url.hostname.toLocaleLowerCase("en-US"))) return null;
    const host = url.hostname.toLocaleLowerCase("en-US");
    const id = host === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v")
        ?? (url.pathname.startsWith("/embed/") ? url.pathname.split("/")[2] : null);
    return id && isYouTubeVideoId(id) ? id : null;
  } catch {
    return null;
  }
}

function isYouTubeVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,20}$/.test(value);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function defaultLog(entry: Record<string, unknown>): void {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
}

class SequentialJsonClient {
  private lastRequestAt = 0;

  constructor(
    private readonly fetchImplementation: typeof fetch,
    private readonly config: JikanEnrichmentConfig,
    private readonly sleep: (milliseconds: number) => Promise<void>,
  ) {}

  async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt += 1) {
      const remainingDelay = this.config.requestDelayMs - (Date.now() - this.lastRequestAt);
      if (remainingDelay > 0) await this.sleep(remainingDelay);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        this.lastRequestAt = Date.now();
        const response = await this.fetchImplementation(url, { ...init, signal: controller.signal });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          if (!RETRYABLE_STATUS.has(response.status) || attempt === this.config.maxRetries) throw error;
          await this.sleep(retryDelay(response.headers.get("retry-after"), attempt));
          continue;
        }
        return await response.json() as T;
      } catch (error) {
        lastError = error;
        if (attempt === this.config.maxRetries || !isRetryableNetworkError(error)) throw error;
        await this.sleep(retryDelay(null, attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Request failed");
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
  return Math.min(1_000 * 2 ** (attempt - 1), 15_000);
}

function supabaseHeaders(config: JikanEnrichmentConfig): Record<string, string> {
  return {
    apikey: config.supabaseServiceRoleKey,
    authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "content-type": "application/json",
  };
}

async function loadMalCandidates(
  config: JikanEnrichmentConfig,
  client: SequentialJsonClient,
): Promise<MalTrailerCandidate[]> {
  const rows: MalTrailerCandidate[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: "id,external_id,title,original_title,popularity_score,rating_average,content_type",
      trailer_url: "is.null",
      source: "eq.MAL",
      order: "popularity_score.desc.nullslast,rating_average.desc.nullslast,id.asc",
      offset: String(offset),
      limit: String(pageSize),
    });
    const page = await client.request<MalTrailerCandidate[]>(`${config.supabaseUrl}/rest/v1/contents?${query}`, {
      headers: supabaseHeaders(config),
    });
    rows.push(...page);
    if (page.length < pageSize) return sortMalTrailerCandidates(rows);
  }
}

async function fetchJikanTrailer(
  malId: string,
  config: JikanEnrichmentConfig,
  client: SequentialJsonClient,
): Promise<string | null> {
  const payload = await client.request<{ data?: { trailer?: JikanTrailerData | null } }>(
    `${config.jikanBaseUrl}/anime/${encodeURIComponent(malId)}/full`,
    { headers: { Accept: "application/json" } },
  );
  return extractJikanTrailer(payload.data?.trailer);
}

export async function writeJikanTrailerReport(path: string, report: JikanTrailerReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function runJikanTrailerEnrichment(options: JikanEnrichmentOptions): Promise<JikanTrailerReport> {
  const log = options.log ?? defaultLog;
  const client = new SequentialJsonClient(
    options.fetchImplementation ?? fetch,
    options.config,
    options.sleep ?? defaultSleep,
  );
  const persistReport = options.writeReport
    ?? ((report: JikanTrailerReport) => writeJikanTrailerReport(options.config.reportPath, report));
  const candidates = await loadMalCandidates(options.config, client);
  const report: JikanTrailerReport = {
    generated_at: (options.now ?? (() => new Date()))().toISOString(),
    checked: candidates.length,
    matched: 0,
    unmatched: 0,
    skipped: 0,
    results: [],
  };
  const processedContentIds = new Set<string>();

  log({ level: "info", event: "jikan_trailer_dry_run_started", candidates: candidates.length });
  for (const candidate of candidates) {
    const contentId = String(candidate.id);
    const malId = String(candidate.external_id ?? "").trim();
    if (processedContentIds.has(contentId) || !/^\d+$/.test(malId) || Number(malId) <= 0) {
      report.skipped += 1;
      report.results.push(toResult(candidate, malId, null, 0, "skipped"));
      await persistReport(report);
      continue;
    }
    processedContentIds.add(contentId);

    try {
      const trailerUrl = await fetchJikanTrailer(malId, options.config, client);
      if (trailerUrl) {
        report.matched += 1;
        report.results.push(toResult(candidate, malId, trailerUrl, 1, "would_update"));
      } else {
        report.unmatched += 1;
        report.results.push(toResult(candidate, malId, null, 0, "unmatched"));
      }
    } catch (error) {
      report.skipped += 1;
      report.results.push(toResult(candidate, malId, null, 0, "error"));
      log({
        level: "error",
        event: "jikan_trailer_record_failed",
        content_id: contentId,
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
    }
    await persistReport(report);
    log({
      level: "info",
      event: "jikan_trailer_record_complete",
      content_id: contentId,
      action: report.results.at(-1)?.action,
    });
  }

  await persistReport(report);
  log({
    level: "info",
    event: "jikan_trailer_dry_run_complete",
    checked: report.checked,
    matched: report.matched,
    unmatched: report.unmatched,
    skipped: report.skipped,
  });
  return report;
}

function toResult(
  candidate: MalTrailerCandidate,
  malId: string,
  trailerUrl: string | null,
  confidence: 0 | 1,
  action: JikanTrailerResult["action"],
): JikanTrailerResult {
  return {
    content_id: candidate.id,
    title: candidate.title,
    mal_id: malId,
    trailer_url: trailerUrl,
    confidence,
    action,
  };
}

export function assertDryRunOnly(argumentsList: string[]): void {
  if (argumentsList.some((argument) => argument === "--apply" || argument.startsWith("--apply="))) {
    throw new Error("Jikan trailer enrichment supports dry-run only");
  }
}

async function main(): Promise<void> {
  assertDryRunOnly(process.argv.slice(2));
  await runJikanTrailerEnrichment({ config: createJikanEnrichmentConfig() });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Jikan trailer dry-run failed");
    process.exitCode = 1;
  });
}
