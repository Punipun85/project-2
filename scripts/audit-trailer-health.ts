import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireEnvironmentValue, type RuntimeEnvironment } from "../lib/env";

export const DEFAULT_TRAILER_HEALTH_REPORT_PATH = resolve("reports", "trailer-health-report.json");

const TMDB_APPLY_REPORT_PATH = resolve("reports", "trailer-apply-result.json");
const JIKAN_ENRICHMENT_REPORT_PATH = resolve("reports", "jikan-trailer-enrichment-report.json");
const JIKAN_APPLY_REPORT_PATH = resolve("reports", "jikan-trailer-apply-result.json");
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export type TrailerHealthContent = {
  id: number | string;
  source?: string | null;
  content_type?: string | null;
  series_type?: string | null;
  trailer_url?: string | null;
};

export type CoverageGroup = {
  total: number;
  with_trailer: number;
  without_trailer: number;
  coverage_percentage: number;
};

export type EnrichmentHistory = {
  tmdb_applied: number;
  jikan_candidates: number;
  jikan_applied: number;
  jikan_apply_status: "not_run" | "completed" | "completed_with_failures" | "unavailable";
};

export type TrailerHealthReport = {
  generated_at: string;
  total_contents: number;
  with_trailer: number;
  without_trailer: number;
  coverage_percentage: number;
  by_source: Record<string, CoverageGroup>;
  by_type: {
    anime: CoverageGroup;
    movie: CoverageGroup;
    series: CoverageGroup;
    documentary: CoverageGroup;
    unknown: CoverageGroup;
  };
  by_series_type: Record<string, CoverageGroup>;
  validation: {
    invalid_urls: number;
    duplicate_urls: number;
  };
  enrichment: EnrichmentHistory;
};

export type TrailerHealthConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  timeoutMs: number;
  maxRetries: number;
  reportPath: string;
};

export type TrailerHealthOptions = {
  config: TrailerHealthConfig;
  fetchImplementation?: typeof fetch;
  readReport?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeReport?: (report: TrailerHealthReport) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function createTrailerHealthConfig(environment: RuntimeEnvironment = process.env): TrailerHealthConfig {
  return {
    supabaseUrl: requireEnvironmentValue("SUPABASE_URL", environment).replace(/\/$/, ""),
    supabaseServiceRoleKey: requireEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY", environment),
    timeoutMs: 10_000,
    maxRetries: 4,
    reportPath: DEFAULT_TRAILER_HEALTH_REPORT_PATH,
  };
}

function emptyCoverage(): CoverageGroup {
  return { total: 0, with_trailer: 0, without_trailer: 0, coverage_percentage: 0 };
}

function finalizeCoverage(group: CoverageGroup): CoverageGroup {
  return {
    ...group,
    coverage_percentage: percentage(group.with_trailer, group.total),
  };
}

function percentage(part: number, total: number): number {
  return total ? Math.round((part / total) * 10_000) / 100 : 0;
}

function addToGroup(group: CoverageGroup, hasTrailer: boolean): void {
  group.total += 1;
  if (hasTrailer) group.with_trailer += 1;
  else group.without_trailer += 1;
}

export function buildTrailerHealthReport(
  contents: TrailerHealthContent[],
  enrichment: EnrichmentHistory,
  generatedAt = new Date().toISOString(),
): TrailerHealthReport {
  const bySource: Record<string, CoverageGroup> = { TMDB: emptyCoverage(), MAL: emptyCoverage() };
  const byType: TrailerHealthReport["by_type"] = {
    anime: emptyCoverage(),
    movie: emptyCoverage(),
    series: emptyCoverage(),
    documentary: emptyCoverage(),
    unknown: emptyCoverage(),
  };
  const bySeriesType: Record<string, CoverageGroup> = {};
  const trailerKeys = new Map<string, number>();
  let withTrailer = 0;
  let invalidUrls = 0;

  for (const content of contents) {
    const trailerUrl = String(content.trailer_url ?? "").trim();
    const hasTrailer = Boolean(trailerUrl);
    if (hasTrailer) withTrailer += 1;

    const source = String(content.source ?? "").trim().toLocaleUpperCase("en-US") || "OTHER";
    bySource[source] ??= emptyCoverage();
    addToGroup(bySource[source], hasTrailer);

    const rawType = String(content.content_type ?? "").trim().toLocaleLowerCase("en-US");
    const type = rawType === "anime" || rawType === "movie" || rawType === "series" || rawType === "documentary"
      ? rawType
      : "unknown";
    addToGroup(byType[type], hasTrailer);

    const seriesType = String(content.series_type ?? "").trim().toLocaleLowerCase("en-US");
    if (seriesType) {
      bySeriesType[seriesType] ??= emptyCoverage();
      addToGroup(bySeriesType[seriesType], hasTrailer);
    }

    if (hasTrailer) {
      const videoId = youtubeVideoId(trailerUrl);
      if (!videoId) invalidUrls += 1;
      const duplicateKey = videoId ? `youtube:${videoId}` : `raw:${trailerUrl.toLocaleLowerCase("en-US")}`;
      trailerKeys.set(duplicateKey, (trailerKeys.get(duplicateKey) ?? 0) + 1);
    }
  }

  const finalizedSources = Object.fromEntries(
    Object.entries(bySource).map(([key, value]) => [key, finalizeCoverage(value)]),
  );
  const finalizedSeriesTypes = Object.fromEntries(
    Object.entries(bySeriesType).map(([key, value]) => [key, finalizeCoverage(value)]),
  );
  const duplicateUrls = [...trailerKeys.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  const totalContents = contents.length;

  return {
    generated_at: generatedAt,
    total_contents: totalContents,
    with_trailer: withTrailer,
    without_trailer: totalContents - withTrailer,
    coverage_percentage: percentage(withTrailer, totalContents),
    by_source: finalizedSources,
    by_type: {
      anime: finalizeCoverage(byType.anime),
      movie: finalizeCoverage(byType.movie),
      series: finalizeCoverage(byType.series),
      documentary: finalizeCoverage(byType.documentary),
      unknown: finalizeCoverage(byType.unknown),
    },
    by_series_type: finalizedSeriesTypes,
    validation: { invalid_urls: invalidUrls, duplicate_urls: duplicateUrls },
    enrichment,
  };
}

function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(hostname)) return null;
    const id = hostname === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v")
        ?? (url.pathname.startsWith("/embed/") ? url.pathname.split("/")[2] : null);
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function loadEnrichmentHistory(
  read: (path: string, encoding: BufferEncoding) => Promise<string>,
): Promise<EnrichmentHistory> {
  const tmdb = await readOptionalJson(TMDB_APPLY_REPORT_PATH, read);
  const jikanEnrichment = await readOptionalJson(JIKAN_ENRICHMENT_REPORT_PATH, read);
  const jikanApply = await readOptionalJson(JIKAN_APPLY_REPORT_PATH, read);

  const tmdbApplied = nonnegativeInteger(tmdb?.updated);
  const jikanCandidates = Array.isArray(jikanEnrichment?.results)
    ? jikanEnrichment.results.filter((result: unknown) =>
      result && typeof result === "object"
      && (result as { action?: unknown }).action === "would_update"
      && Number((result as { confidence?: unknown }).confidence) === 1,
    ).length
    : nonnegativeInteger(jikanEnrichment?.matched);
  const jikanApplied = nonnegativeInteger(jikanApply?.updated);
  const jikanFailures = nonnegativeInteger(jikanApply?.failed);

  return {
    tmdb_applied: tmdbApplied,
    jikan_candidates: jikanCandidates,
    jikan_applied: jikanApplied,
    jikan_apply_status: jikanApply
      ? jikanFailures > 0 ? "completed_with_failures" : "completed"
      : "not_run",
  };
}

async function readOptionalJson(
  path: string,
  read: (path: string, encoding: BufferEncoding) => Promise<string>,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await read(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") return null;
    return null;
  }
}

function nonnegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

class SupabaseReadClient {
  constructor(
    private readonly fetchImplementation: typeof fetch,
    private readonly config: TrailerHealthConfig,
    private readonly sleep: (milliseconds: number) => Promise<void>,
  ) {}

  async get<T>(path: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.fetchImplementation(`${this.config.supabaseUrl}/rest/v1/${path}`, {
          method: "GET",
          signal: controller.signal,
          headers: {
            apikey: this.config.supabaseServiceRoleKey,
            authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
            Accept: "application/json",
          },
        });
        if (!response.ok) {
          const error = new Error(`Supabase audit request failed with HTTP ${response.status}`);
          if (!RETRYABLE_STATUS.has(response.status) || attempt === this.config.maxRetries) throw error;
          await this.sleep(Math.min(500 * 2 ** (attempt - 1), 10_000));
          continue;
        }
        return await response.json() as T;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof TypeError
          || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
        if (!retryable || attempt === this.config.maxRetries) throw error;
        await this.sleep(Math.min(500 * 2 ** (attempt - 1), 10_000));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Supabase audit request failed");
  }
}

async function loadAllContents(config: TrailerHealthConfig, client: SupabaseReadClient): Promise<TrailerHealthContent[]> {
  const rows: TrailerHealthContent[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: "id,source,content_type,series_type,trailer_url",
      order: "id.asc",
      offset: String(offset),
      limit: String(pageSize),
    });
    const page = await client.get<TrailerHealthContent[]>(`contents?${query}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function writeReportAtomic(path: string, report: TrailerHealthReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function runTrailerHealthAudit(options: TrailerHealthOptions): Promise<TrailerHealthReport> {
  const client = new SupabaseReadClient(
    options.fetchImplementation ?? fetch,
    options.config,
    options.sleep ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))),
  );
  const [contents, enrichment] = await Promise.all([
    loadAllContents(options.config, client),
    loadEnrichmentHistory(options.readReport ?? readFile),
  ]);
  const report = buildTrailerHealthReport(
    contents,
    enrichment,
    (options.now ?? (() => new Date()))().toISOString(),
  );
  await (options.writeReport ?? ((value) => writeReportAtomic(options.config.reportPath, value)))(report);
  return report;
}

export function formatTrailerHealthSummary(report: TrailerHealthReport): string {
  return [
    "NEXAPLAY TRAILER HEALTH AUDIT",
    "==============================",
    `Total contents: ${report.total_contents}`,
    `With trailer: ${report.with_trailer}`,
    `Without trailer: ${report.without_trailer}`,
    `Coverage: ${report.coverage_percentage}%`,
    `Invalid URLs: ${report.validation.invalid_urls}`,
    `Duplicate URLs: ${report.validation.duplicate_urls}`,
    `TMDB applied: ${report.enrichment.tmdb_applied}`,
    `Jikan candidates: ${report.enrichment.jikan_candidates}`,
    `Jikan applied: ${report.enrichment.jikan_applied} (${report.enrichment.jikan_apply_status})`,
  ].join("\n");
}

async function main(): Promise<void> {
  const report = await runTrailerHealthAudit({ config: createTrailerHealthConfig() });
  console.info(formatTrailerHealthSummary(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Trailer health audit failed");
    process.exitCode = 1;
  });
}
