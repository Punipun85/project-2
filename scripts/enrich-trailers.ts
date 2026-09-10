import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireEnvironmentValue, type RuntimeEnvironment } from "../lib/env";

export type EnrichmentMode = "dry-run" | "apply";
export type ProviderMediaType = "movie" | "tv";

export type ContentCandidate = {
  id: number | string;
  external_id: string;
  source: string;
  content_type: string;
  series_type?: string | null;
  title: string;
  original_title?: string | null;
  alternative_titles?: unknown;
  release_year?: number | null;
  popularity_score?: number | null;
  rating_average?: number | null;
};

export type TmdbSearchResult = {
  id?: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  name?: string;
  original_name?: string;
  first_air_date?: string;
};

export type TmdbVideo = {
  key?: string;
  name?: string;
  site?: string;
  type?: string;
  official?: boolean;
  published_at?: string;
};

export type SelectedTrailer = {
  videoId: string;
  url: string;
  type: "Trailer" | "Teaser";
  official: boolean;
  confidence: number;
};

export type EnrichmentResult = {
  content_id: number | string;
  title: string;
  source: string;
  matched_provider: string | null;
  trailer_url: string | null;
  confidence: number;
  action: "would_update" | "updated" | "unmatched" | "skipped" | "skipped_existing" | "error";
};

export type EnrichmentReport = {
  generated_at: string;
  total_checked: number;
  matched: number;
  unmatched: number;
  skipped: number;
  applied: number;
  results: EnrichmentResult[];
};

export type TrailerEnrichmentConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  tmdbApiKey: string;
  timeoutMs: number;
  maxRetries: number;
  requestDelayMs: number;
  reportPath: string;
};

export type TrailerEnrichmentOptions = {
  mode?: EnrichmentMode;
  config: TrailerEnrichmentConfig;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  writeReport?: (report: EnrichmentReport) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
};

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const REJECTED_VIDEO_TITLE = /\b(?:fan[ -]?made|fan trailer|concept trailer|clip|scene|gameplay|reaction)\b/i;
const CONTENT_TYPE_PRIORITY: Record<string, number> = { movie: 3, series: 2, anime: 1 };
const MINIMUM_APPLY_CONFIDENCE = 0.85;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function defaultLog(entry: Record<string, unknown>): void {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
}

export function createTrailerEnrichmentConfig(
  environment: RuntimeEnvironment = process.env,
): TrailerEnrichmentConfig {
  return {
    supabaseUrl: requireEnvironmentValue("SUPABASE_URL", environment).replace(/\/$/, ""),
    supabaseServiceRoleKey: requireEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY", environment),
    tmdbApiKey: requireEnvironmentValue("TMDB_API_KEY", environment),
    timeoutMs: 10_000,
    maxRetries: 4,
    requestDelayMs: 250,
    reportPath: resolve("reports", "trailer-enrichment-report.json"),
  };
}

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function textValues(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return textValues(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(textValues);
  }
  return [];
}

function uniqueTitles(candidate: ContentCandidate): Array<{ value: string; kind: "title" | "original" | "alternative" }> {
  const entries: Array<{ value: string; kind: "title" | "original" | "alternative" }> = [
    { value: candidate.title, kind: "title" },
  ];
  if (candidate.original_title) entries.push({ value: candidate.original_title, kind: "original" });
  entries.push(...textValues(candidate.alternative_titles).map((value) => ({ value, kind: "alternative" as const })));

  const seen = new Set<string>();
  return entries.filter(({ value }) => {
    const normalized = normalizeTitle(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function providerTitles(result: TmdbSearchResult): string[] {
  return [result.title, result.original_title, result.name, result.original_name]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeTitle);
}

function providerYear(result: TmdbSearchResult): number | null {
  const date = result.release_date ?? result.first_air_date;
  const year = date?.slice(0, 4);
  return year && /^\d{4}$/.test(year) ? Number(year) : null;
}

export function calculateMatchConfidence(
  candidate: ContentCandidate,
  result: TmdbSearchResult,
): number {
  const available = new Set(providerTitles(result));
  const primary = normalizeTitle(candidate.title);
  const original = normalizeTitle(candidate.original_title ?? "");
  const alternatives = textValues(candidate.alternative_titles).map(normalizeTitle);

  let matchKind: "title" | "original" | "alternative" | null = null;
  if (primary && available.has(primary)) matchKind = "title";
  else if (original && available.has(original)) matchKind = "original";
  else if (alternatives.some((title) => title && available.has(title))) matchKind = "alternative";
  if (!matchKind) return 0;

  const expectedYear = Number(candidate.release_year ?? 0) || null;
  const actualYear = providerYear(result);
  const yearDelta = expectedYear && actualYear ? Math.abs(expectedYear - actualYear) : null;

  if (matchKind === "title") {
    if (yearDelta === 0) return 0.97;
    if (yearDelta === 1) return 0.90;
    if (yearDelta === null) return 0.93;
    return 0.8;
  }
  if (matchKind === "original") {
    if (yearDelta === 0) return 0.89;
    if (yearDelta === null) return 0.86;
    return 0.82;
  }
  if (yearDelta === 0) return 0.87;
  if (yearDelta === null) return 0.85;
  return 0.8;
}

export function isRejectedTrailerTitle(value: string): boolean {
  return REJECTED_VIDEO_TITLE.test(value);
}

export function selectTrailer(
  videos: TmdbVideo[],
  confidence: number,
): SelectedTrailer | null {
  const candidates = videos
    .filter((video): video is TmdbVideo & { key: string; type: "Trailer" | "Teaser" } => {
      const type = String(video.type ?? "");
      return String(video.site ?? "").toLocaleLowerCase("en-US") === "youtube"
        && Boolean(video.key?.trim())
        && (type === "Trailer" || type === "Teaser")
        && !isRejectedTrailerTitle(String(video.name ?? ""));
    })
    .sort((left, right) => {
      const priority = (video: TmdbVideo): number => {
        if (video.type === "Trailer" && video.official) return 4;
        if (video.type === "Trailer") return 3;
        if (video.type === "Teaser" && video.official) return 2;
        return 1;
      };
      return priority(right) - priority(left)
        || String(right.published_at ?? "").localeCompare(String(left.published_at ?? ""));
    });

  const selected = candidates[0];
  if (!selected) return null;
  return {
    videoId: selected.key,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(selected.key)}`,
    type: selected.type,
    official: Boolean(selected.official),
    confidence,
  };
}

export function sortContentCandidates(candidates: ContentCandidate[]): ContentCandidate[] {
  const numeric = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return [...candidates].sort((left, right) =>
    numeric(right.popularity_score) - numeric(left.popularity_score)
    || numeric(right.rating_average) - numeric(left.rating_average)
    || (CONTENT_TYPE_PRIORITY[right.content_type] ?? 0) - (CONTENT_TYPE_PRIORITY[left.content_type] ?? 0)
    || numeric(left.id) - numeric(right.id),
  );
}

class SafeJsonClient {
  private lastRequestAt = 0;

  constructor(
    private readonly fetchImplementation: typeof fetch,
    private readonly timeoutMs: number,
    private readonly maxRetries: number,
    private readonly requestDelayMs: number,
    private readonly sleep: (milliseconds: number) => Promise<void>,
  ) {}

  async request<T>(url: string, init: RequestInit = {}): Promise<{ data: T; response: Response }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < this.requestDelayMs) await this.sleep(this.requestDelayMs - elapsed);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        this.lastRequestAt = Date.now();
        const response = await this.fetchImplementation(url, { ...init, signal: controller.signal });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          if (!RETRYABLE_STATUS.has(response.status) || attempt === this.maxRetries) throw error;
          const retryAfter = response.headers.get("retry-after");
          await this.sleep(retryAfterDelay(retryAfter) ?? backoffDelay(attempt));
          continue;
        }
        const data = response.status === 204 ? undefined as T : await response.json() as T;
        return { data, response };
      } catch (error) {
        lastError = error;
        if (attempt === this.maxRetries || !isRetryableNetworkError(error)) throw error;
        await this.sleep(backoffDelay(attempt));
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

function retryAfterDelay(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1_000, 0), 30_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.min(Math.max(date - Date.now(), 0), 30_000);
}

function backoffDelay(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250), 15_000);
}

function supabaseHeaders(config: TrailerEnrichmentConfig): Record<string, string> {
  return {
    apikey: config.supabaseServiceRoleKey,
    authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "content-type": "application/json",
  };
}

async function loadCandidates(
  config: TrailerEnrichmentConfig,
  client: SafeJsonClient,
): Promise<ContentCandidate[]> {
  const rows: ContentCandidate[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: "id,external_id,source,content_type,series_type,title,original_title,alternative_titles,release_year,popularity_score,rating_average",
      is_active: "eq.true",
      trailer_url: "is.null",
      order: "popularity_score.desc.nullslast,rating_average.desc.nullslast,id.asc",
      offset: String(offset),
      limit: String(pageSize),
    });
    const { data } = await client.request<ContentCandidate[]>(
      `${config.supabaseUrl}/rest/v1/contents?${query}`,
      { headers: supabaseHeaders(config) },
    );
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

function mediaTypesFor(candidate: ContentCandidate): ProviderMediaType[] {
  if (candidate.content_type === "movie" || candidate.content_type === "documentary") return ["movie"];
  if (candidate.content_type === "series") return ["tv"];
  if (candidate.content_type === "anime") return ["tv", "movie"];
  return [];
}

async function tmdbRequest<T>(
  client: SafeJsonClient,
  config: TrailerEnrichmentConfig,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const query = new URLSearchParams({ api_key: config.tmdbApiKey, language: "en-US", ...params });
  return (await client.request<T>(`${TMDB_BASE_URL}/${path}?${query}`)).data;
}

async function fetchVideos(
  client: SafeJsonClient,
  config: TrailerEnrichmentConfig,
  mediaType: ProviderMediaType,
  providerId: number | string,
): Promise<TmdbVideo[]> {
  const payload = await tmdbRequest<{ results?: TmdbVideo[] }>(client, config, `${mediaType}/${providerId}/videos`);
  return Array.isArray(payload.results) ? payload.results : [];
}

type ResolvedProviderTrailer = { provider: string; trailer: SelectedTrailer };

async function resolveTrailer(
  candidate: ContentCandidate,
  client: SafeJsonClient,
  config: TrailerEnrichmentConfig,
): Promise<ResolvedProviderTrailer | null> {
  const mediaTypes = mediaTypesFor(candidate);
  if (!mediaTypes.length) return null;

  if (candidate.source.trim().toLocaleUpperCase("en-US") === "TMDB" && /^\d+$/.test(candidate.external_id)) {
    for (const mediaType of mediaTypes) {
      const videos = await fetchVideos(client, config, mediaType, candidate.external_id);
      const trailer = selectTrailer(videos, 1);
      if (trailer) return { provider: `TMDB:${mediaType}:${candidate.external_id}`, trailer };
    }
    return null;
  }

  const attemptedProviderIds = new Set<string>();
  for (const mediaType of mediaTypes) {
    for (const title of uniqueTitles(candidate)) {
      const searchParams: Record<string, string> = { query: title.value, include_adult: "false" };
      if (candidate.release_year) {
        searchParams[mediaType === "movie" ? "primary_release_year" : "first_air_date_year"] = String(candidate.release_year);
      }
      let payload = await tmdbRequest<{ results?: TmdbSearchResult[] }>(
        client,
        config,
        `search/${mediaType}`,
        searchParams,
      );
      if ((!payload.results?.length) && candidate.release_year) {
        delete searchParams[mediaType === "movie" ? "primary_release_year" : "first_air_date_year"];
        payload = await tmdbRequest(client, config, `search/${mediaType}`, searchParams);
      }

      const matches = (payload.results ?? [])
        .map((result) => ({ result, confidence: calculateMatchConfidence(candidate, result) }))
        .filter(({ result, confidence }) => result.id && confidence >= MINIMUM_APPLY_CONFIDENCE)
        .sort((left, right) => right.confidence - left.confidence || Number(left.result.id) - Number(right.result.id));

      for (const match of matches.slice(0, 3)) {
        const providerKey = `${mediaType}:${match.result.id}`;
        if (attemptedProviderIds.has(providerKey)) continue;
        attemptedProviderIds.add(providerKey);
        const videos = await fetchVideos(client, config, mediaType, match.result.id!);
        const trailer = selectTrailer(videos, match.confidence);
        if (trailer) return { provider: `TMDB:${providerKey}`, trailer };
      }
    }
  }
  return null;
}

async function guardedUpdate(
  candidate: ContentCandidate,
  trailerUrl: string,
  config: TrailerEnrichmentConfig,
  client: SafeJsonClient,
): Promise<boolean> {
  const query = new URLSearchParams({ id: `eq.${candidate.id}`, trailer_url: "is.null", select: "id" });
  const { data } = await client.request<Array<{ id: number | string }>>(
    `${config.supabaseUrl}/rest/v1/contents?${query}`,
    {
      method: "PATCH",
      headers: { ...supabaseHeaders(config), Prefer: "return=representation" },
      body: JSON.stringify({ trailer_url: trailerUrl }),
    },
  );
  return data.length === 1;
}

export async function writeTrailerReport(
  reportPath: string,
  report: EnrichmentReport,
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(temporaryPath, reportPath);
}

export async function runTrailerEnrichment(options: TrailerEnrichmentOptions): Promise<EnrichmentReport> {
  const mode = options.mode ?? "dry-run";
  const log = options.log ?? defaultLog;
  const now = options.now ?? (() => new Date());
  const client = new SafeJsonClient(
    options.fetchImplementation ?? fetch,
    options.config.timeoutMs,
    options.config.maxRetries,
    options.config.requestDelayMs,
    options.sleep ?? defaultSleep,
  );
  const persistReport = options.writeReport
    ?? ((report: EnrichmentReport) => writeTrailerReport(options.config.reportPath, report));
  const candidates = sortContentCandidates(await loadCandidates(options.config, client));
  const report: EnrichmentReport = {
    generated_at: now().toISOString(),
    total_checked: candidates.length,
    matched: 0,
    unmatched: 0,
    skipped: 0,
    applied: 0,
    results: [],
  };
  const processedContentIds = new Set<string>();
  const selectedVideoIds = new Map<string, string>();

  log({ level: "info", event: "trailer_enrichment_started", mode, candidates: candidates.length });
  for (const candidate of candidates) {
    const contentId = String(candidate.id);
    if (processedContentIds.has(contentId)) {
      report.skipped += 1;
      report.results.push(resultFor(candidate, null, null, 0, "skipped"));
      continue;
    }
    processedContentIds.add(contentId);

    try {
      const resolved = await resolveTrailer(candidate, client, options.config);
      if (!resolved || resolved.trailer.confidence < MINIMUM_APPLY_CONFIDENCE) {
        report.unmatched += 1;
        report.results.push(resultFor(candidate, null, null, resolved?.trailer.confidence ?? 0, "unmatched"));
      } else {
        const previousContentId = selectedVideoIds.get(resolved.trailer.videoId);
        if (previousContentId && previousContentId !== contentId) {
          report.skipped += 1;
          report.results.push(resultFor(candidate, resolved.provider, resolved.trailer.url, resolved.trailer.confidence, "skipped"));
        } else {
          selectedVideoIds.set(resolved.trailer.videoId, contentId);
          report.matched += 1;
          if (mode === "apply") {
            const updated = await guardedUpdate(candidate, resolved.trailer.url, options.config, client);
            if (updated) {
              report.applied += 1;
              report.results.push(resultFor(candidate, resolved.provider, resolved.trailer.url, resolved.trailer.confidence, "updated"));
            } else {
              report.skipped += 1;
              report.results.push(resultFor(candidate, resolved.provider, resolved.trailer.url, resolved.trailer.confidence, "skipped_existing"));
            }
          } else {
            report.results.push(resultFor(candidate, resolved.provider, resolved.trailer.url, resolved.trailer.confidence, "would_update"));
          }
        }
      }
    } catch (error) {
      report.skipped += 1;
      report.results.push(resultFor(candidate, null, null, 0, "error"));
      log({
        level: "error",
        event: "trailer_enrichment_record_failed",
        content_id: contentId,
        error_type: error instanceof Error ? error.name : "UnknownError",
      });
    }

    await persistReport(report);
    const current = report.results.at(-1)!;
    log({
      level: "info",
      event: "trailer_enrichment_record_complete",
      content_id: contentId,
      action: current.action,
      confidence: current.confidence,
    });
  }
  await persistReport(report);
  log({
    level: "info",
    event: "trailer_enrichment_complete",
    mode,
    total_checked: report.total_checked,
    matched: report.matched,
    unmatched: report.unmatched,
    skipped: report.skipped,
    applied: report.applied,
  });
  return report;
}

function resultFor(
  candidate: ContentCandidate,
  provider: string | null,
  trailerUrl: string | null,
  confidence: number,
  action: EnrichmentResult["action"],
): EnrichmentResult {
  return {
    content_id: candidate.id,
    title: candidate.title,
    source: candidate.source,
    matched_provider: provider,
    trailer_url: trailerUrl,
    confidence,
    action,
  };
}

export function parseMode(argumentsList: string[]): EnrichmentMode {
  if (argumentsList.includes("--apply") && argumentsList.includes("--dry-run")) {
    throw new Error("Choose either --dry-run or --apply, not both");
  }
  return argumentsList.includes("--apply") ? "apply" : "dry-run";
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const config = createTrailerEnrichmentConfig();
  await runTrailerEnrichment({ mode, config });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "trailer_enrichment_failed",
      error_type: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown error",
    }));
    process.exitCode = 1;
  });
}
