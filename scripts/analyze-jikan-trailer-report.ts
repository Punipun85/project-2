import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_JIKAN_REPORT_PATH,
  type JikanTrailerReport,
  type JikanTrailerResult,
} from "./enrich-jikan-trailers";

export const DEFAULT_JIKAN_ANALYSIS_PATH = resolve("reports", "jikan-trailer-enrichment-analysis.json");

export type JikanTrailerAnalysis = {
  generated_at: string;
  input_generated_at: string | null;
  total_results: number;
  confidence_distribution: { confirmed: number; unavailable: number };
  action_distribution: { would_update: number; unmatched: number; skipped: number };
  safe_candidates: number;
  invalid_mal_ids: number;
  invalid_trailer_urls: number;
  duplicate_content_ids: number;
  report_consistent: boolean;
};

export class JikanTrailerReportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JikanTrailerReportError";
  }
}

export async function loadJikanTrailerReport(
  path = DEFAULT_JIKAN_REPORT_PATH,
  read: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<JikanTrailerReport> {
  let raw: string;
  try {
    raw = await read(path, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") throw new JikanTrailerReportError(`Jikan trailer report not found: ${path}`, { cause: error });
    throw new JikanTrailerReportError(`Could not read Jikan trailer report: ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new JikanTrailerReportError(`Jikan trailer report contains invalid JSON: ${path}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { results?: unknown }).results)) {
    throw new JikanTrailerReportError("Jikan trailer report must contain a results array");
  }
  return parsed as JikanTrailerReport;
}

export function analyzeJikanTrailerReport(
  report: JikanTrailerReport,
  generatedAt = new Date().toISOString(),
): JikanTrailerAnalysis {
  const confidence = { confirmed: 0, unavailable: 0 };
  const actions = { would_update: 0, unmatched: 0, skipped: 0 };
  const seenIds = new Set<string>();
  let invalidMalIds = 0;
  let invalidTrailerUrls = 0;
  let duplicateContentIds = 0;

  for (const result of report.results) {
    if (result.confidence === 1) confidence.confirmed += 1;
    else confidence.unavailable += 1;

    if (result.action === "would_update") actions.would_update += 1;
    else if (result.action === "unmatched") actions.unmatched += 1;
    else actions.skipped += 1;

    if (!/^\d+$/.test(String(result.mal_id)) || Number(result.mal_id) <= 0) invalidMalIds += 1;
    if (result.trailer_url && !isCanonicalYouTubeUrl(result.trailer_url)) invalidTrailerUrls += 1;
    const contentId = String(result.content_id);
    if (seenIds.has(contentId)) duplicateContentIds += 1;
    seenIds.add(contentId);
  }

  const safeCandidates = report.results.filter(isSafeResult).length;
  return {
    generated_at: generatedAt,
    input_generated_at: report.generated_at || null,
    total_results: report.results.length,
    confidence_distribution: confidence,
    action_distribution: actions,
    safe_candidates: safeCandidates,
    invalid_mal_ids: invalidMalIds,
    invalid_trailer_urls: invalidTrailerUrls,
    duplicate_content_ids: duplicateContentIds,
    report_consistent: report.checked === report.results.length
      && report.matched === actions.would_update
      && report.unmatched === actions.unmatched
      && report.skipped === actions.skipped,
  };
}

function isSafeResult(result: JikanTrailerResult): boolean {
  return result.action === "would_update"
    && result.confidence === 1
    && Boolean(result.trailer_url && isCanonicalYouTubeUrl(result.trailer_url));
}

function isCanonicalYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname.toLocaleLowerCase("en-US"))
      && Boolean(url.searchParams.get("v"));
  } catch {
    return false;
  }
}

async function writeAnalysis(path: string, analysis: JikanTrailerAnalysis): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export function formatJikanAnalysis(analysis: JikanTrailerAnalysis): string {
  return [
    "NEXAPLAY JIKAN TRAILER ANALYSIS",
    "================================",
    `Results: ${analysis.total_results}`,
    `Confirmed: ${analysis.confidence_distribution.confirmed}`,
    `Unavailable: ${analysis.confidence_distribution.unavailable}`,
    `Would update: ${analysis.action_distribution.would_update}`,
    `Unmatched: ${analysis.action_distribution.unmatched}`,
    `Skipped: ${analysis.action_distribution.skipped}`,
    `Safe candidates: ${analysis.safe_candidates}`,
    `Invalid MAL IDs: ${analysis.invalid_mal_ids}`,
    `Invalid trailer URLs: ${analysis.invalid_trailer_urls}`,
    `Report consistent: ${analysis.report_consistent ? "YES" : "NO"}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const report = await loadJikanTrailerReport();
  const analysis = analyzeJikanTrailerReport(report);
  await writeAnalysis(DEFAULT_JIKAN_ANALYSIS_PATH, analysis);
  console.info(formatJikanAnalysis(analysis));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Jikan trailer analysis failed");
    process.exitCode = 1;
  });
}
