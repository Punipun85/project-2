import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_TRAILER_REPORT_PATH = resolve("reports", "trailer-enrichment-report.json");
export const DEFAULT_TRAILER_ANALYSIS_PATH = resolve("reports", "trailer-enrichment-analysis.json");
export const DEFAULT_TRAILER_CANDIDATES_PATH = resolve("reports", "trailer-apply-candidates.json");

type TrailerAction = "would_update" | "updated" | "unmatched" | "skipped" | "skipped_existing" | "error";
type ContentTypeGroup = "anime" | "movie" | "series" | "documentary" | "unknown";

export type TrailerReportResult = {
  content_id: number | string;
  title: string;
  source: string;
  matched_provider: string | null;
  trailer_url: string | null;
  confidence: number;
  action: TrailerAction | string;
  content_type?: string | null;
};

export type TrailerEnrichmentReport = {
  generated_at?: string;
  total_checked?: number;
  matched?: number;
  unmatched?: number;
  skipped?: number;
  applied?: number;
  results: TrailerReportResult[];
};

export type TrailerApplyCandidate = Pick<
  TrailerReportResult,
  "content_id" | "title" | "trailer_url" | "confidence" | "source" | "matched_provider"
>;

export type TrailerReportAnalysis = {
  generated_at: string;
  input_generated_at: string | null;
  total_results: number;
  confidence_groups: {
    high: number;
    medium: number;
    low: number;
    failed: number;
  };
  action_distribution: {
    would_update: number;
    unmatched: number;
    skipped: number;
  };
  source_distribution: {
    TMDB: number;
    MAL: number;
    other: number;
  };
  content_type_distribution: Record<ContentTypeGroup, number>;
  risk_classification: {
    safe_apply: number;
    manual_review: number;
    reject_review: number;
  };
  apply_candidates_count: number;
  notes: string[];
};

export class TrailerReportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TrailerReportError";
  }
}

export async function loadTrailerReport(
  path = DEFAULT_TRAILER_REPORT_PATH,
  read: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<TrailerEnrichmentReport> {
  let raw: string;
  try {
    raw = await read(path, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") {
      throw new TrailerReportError(`Trailer enrichment report not found: ${path}`, { cause: error });
    }
    throw new TrailerReportError(`Could not read trailer enrichment report: ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TrailerReportError(`Trailer enrichment report contains invalid JSON: ${path}`, { cause: error });
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { results?: unknown }).results)) {
    throw new TrailerReportError("Trailer enrichment report must contain a results array");
  }

  const report = parsed as TrailerEnrichmentReport;
  for (const [index, result] of report.results.entries()) {
    if (!result || typeof result !== "object") {
      throw new TrailerReportError(`Invalid result at index ${index}`);
    }
    if (!("content_id" in result) || typeof result.title !== "string" || typeof result.source !== "string") {
      throw new TrailerReportError(`Result at index ${index} is missing required identity fields`);
    }
    if (!Number.isFinite(Number(result.confidence))) {
      throw new TrailerReportError(`Result at index ${index} has invalid confidence`);
    }
  }
  return report;
}

export function analyzeTrailerReport(
  report: TrailerEnrichmentReport,
  generatedAt = new Date().toISOString(),
): { analysis: TrailerReportAnalysis; candidates: TrailerApplyCandidate[] } {
  const confidenceGroups = { high: 0, medium: 0, low: 0, failed: 0 };
  const actionDistribution = { would_update: 0, unmatched: 0, skipped: 0 };
  const sourceDistribution = { TMDB: 0, MAL: 0, other: 0 };
  const contentTypeDistribution: Record<ContentTypeGroup, number> = {
    anime: 0,
    movie: 0,
    series: 0,
    documentary: 0,
    unknown: 0,
  };
  const riskClassification = { safe_apply: 0, manual_review: 0, reject_review: 0 };

  for (const result of report.results) {
    const confidence = normalizeConfidence(result.confidence);
    if (confidence >= 0.95) confidenceGroups.high += 1;
    else if (confidence >= 0.9) confidenceGroups.medium += 1;
    else if (confidence >= 0.85) confidenceGroups.low += 1;
    else confidenceGroups.failed += 1;

    if (result.action === "would_update") actionDistribution.would_update += 1;
    else if (result.action === "unmatched") actionDistribution.unmatched += 1;
    else actionDistribution.skipped += 1;

    const source = result.source.trim().toLocaleUpperCase("en-US");
    if (source === "TMDB") sourceDistribution.TMDB += 1;
    else if (source === "MAL") sourceDistribution.MAL += 1;
    else sourceDistribution.other += 1;

    contentTypeDistribution[inferContentType(result)] += 1;

    if (result.action === "would_update" && confidence >= 0.95) riskClassification.safe_apply += 1;
    else if (result.action === "would_update" && confidence >= 0.85) riskClassification.manual_review += 1;
    if (confidence === 0) riskClassification.reject_review += 1;
  }

  const candidates = filterApplyCandidates(report.results);
  const hasExplicitContentTypes = report.results.some((result) => normalizeContentType(result.content_type) !== "unknown");
  const analysis: TrailerReportAnalysis = {
    generated_at: generatedAt,
    input_generated_at: typeof report.generated_at === "string" ? report.generated_at : null,
    total_results: report.results.length,
    confidence_groups: confidenceGroups,
    action_distribution: actionDistribution,
    source_distribution: sourceDistribution,
    content_type_distribution: contentTypeDistribution,
    risk_classification: riskClassification,
    apply_candidates_count: candidates.length,
    notes: hasExplicitContentTypes
      ? []
      : [
        "The source report has no content_type field. Anime is inferred from MAL/JIKAN; movie/series from matched TMDB provider namespace; unresolved records remain unknown.",
      ],
  };
  return { analysis, candidates };
}

export function filterApplyCandidates(results: TrailerReportResult[]): TrailerApplyCandidate[] {
  return results
    .filter((result) =>
      result.action === "would_update"
      && normalizeConfidence(result.confidence) >= 0.95
      && Boolean(result.trailer_url)
      && Boolean(result.matched_provider),
    )
    .map((result) => ({
      content_id: result.content_id,
      title: result.title,
      trailer_url: result.trailer_url,
      confidence: normalizeConfidence(result.confidence),
      source: result.source,
      matched_provider: result.matched_provider,
    }));
}

function normalizeConfidence(value: unknown): number {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0;
  return Math.min(Math.max(confidence, 0), 1);
}

function normalizeContentType(value: unknown): ContentTypeGroup {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return ["anime", "movie", "series", "documentary"].includes(normalized)
    ? normalized as ContentTypeGroup
    : "unknown";
}

export function inferContentType(result: TrailerReportResult): ContentTypeGroup {
  const explicit = normalizeContentType(result.content_type);
  if (explicit !== "unknown") return explicit;

  const source = result.source.trim().toLocaleUpperCase("en-US");
  if (source === "MAL" || source === "JIKAN") return "anime";

  const provider = String(result.matched_provider ?? "").toLocaleLowerCase("en-US");
  if (provider.includes(":movie:")) return "movie";
  if (provider.includes(":tv:")) return "series";
  return "unknown";
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export function formatConsoleSummary(analysis: TrailerReportAnalysis): string {
  return [
    "NEXAPLAY TRAILER ENRICHMENT ANALYSIS",
    "====================================",
    `Results analyzed: ${analysis.total_results}`,
    "",
    `Confidence: high=${analysis.confidence_groups.high}, medium=${analysis.confidence_groups.medium}, low=${analysis.confidence_groups.low}, failed=${analysis.confidence_groups.failed}`,
    `Actions: would_update=${analysis.action_distribution.would_update}, unmatched=${analysis.action_distribution.unmatched}, skipped=${analysis.action_distribution.skipped}`,
    `Sources: TMDB=${analysis.source_distribution.TMDB}, MAL=${analysis.source_distribution.MAL}, other=${analysis.source_distribution.other}`,
    `Types: anime=${analysis.content_type_distribution.anime}, movie=${analysis.content_type_distribution.movie}, series=${analysis.content_type_distribution.series}, documentary=${analysis.content_type_distribution.documentary}, unknown=${analysis.content_type_distribution.unknown}`,
    `Risk: safe_apply=${analysis.risk_classification.safe_apply}, manual_review=${analysis.risk_classification.manual_review}, reject_review=${analysis.risk_classification.reject_review}`,
    `Apply candidates: ${analysis.apply_candidates_count}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const report = await loadTrailerReport();
  const { analysis, candidates } = analyzeTrailerReport(report);
  await writeJsonAtomic(DEFAULT_TRAILER_ANALYSIS_PATH, analysis);
  await writeJsonAtomic(DEFAULT_TRAILER_CANDIDATES_PATH, candidates);
  console.info(formatConsoleSummary(analysis));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Trailer report analysis failed");
    process.exitCode = 1;
  });
}
