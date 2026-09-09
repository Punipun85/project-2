import type { ContentType, EntertainmentContent } from "@/lib/content-types";
import {
  getEnvironmentValue,
  readRuntimeEnv,
  type RuntimeEnvironment,
  validateProductionServiceUrls,
} from "@/lib/env";

export type RecommendationServiceConfig = Readonly<{
  apiUrl: string;
  apiKey: string;
  isConfigured: boolean;
  validationErrors: string[];
}>;

type RecommendationRow = Record<string, unknown> & {
  id?: number | string;
  content_id?: number | string;
  external_id?: string;
  source?: string;
  content_type?: string;
  series_type?: string | null;
  title?: string;
  original_title?: string | null;
  overview?: string | null;
  poster_url?: string | null;
  backdrop_url?: string | null;
  original_language?: string | null;
  country?: unknown;
  release_year?: number | null;
  director?: unknown;
  cast?: unknown;
  genres?: unknown;
  themes?: unknown;
  rating_average?: number | null;
  popularity_score?: number | null;
  content_score?: number;
  collaborative_score?: number;
  context_score?: number;
  final_score?: number;
  reason?: string;
  strategy?: string;
};

export type PersonalizedRecommendation = EntertainmentContent & {
  recommendationStrategy: string;
  scores: {
    content: number;
    collaborative: number;
    context: number;
    final: number;
  };
};

export function createRecommendationServiceConfig(
  environment: RuntimeEnvironment = readRuntimeEnv(),
): RecommendationServiceConfig {
  const apiUrl = getEnvironmentValue("RECOMMENDATION_API_URL", environment).replace(/\/$/, "");
  const apiKey = getEnvironmentValue("RECOMMENDATION_API_KEY", environment);
  const validationErrors = [
    ...(!apiUrl ? ["Missing required environment variable: RECOMMENDATION_API_URL"] : []),
    ...(!apiKey ? ["Missing required environment variable: RECOMMENDATION_API_KEY"] : []),
    ...validateProductionServiceUrls(["RECOMMENDATION_API_URL"], environment),
  ];
  return Object.freeze({
    apiUrl,
    apiKey,
    isConfigured: validationErrors.length === 0,
    validationErrors,
  });
}

function labels(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      return labels(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      for (const key of ["name", "title", "character"]) {
        if (typeof record[key] === "string") return [record[key] as string];
      }
    }
    return [];
  });
}

function first(value: unknown, fallback = "Unknown"): string {
  return labels(value)[0] ?? fallback;
}

function normalizeType(row: RecommendationRow): ContentType {
  if (row.content_type === "series" && row.series_type === "kdrama") return "kdrama";
  if (row.content_type === "tv_series") return "series";
  if (["movie", "anime", "kdrama", "series", "documentary"].includes(row.content_type ?? "")) {
    return row.content_type as ContentType;
  }
  return "movie";
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapRecommendationRow(row: RecommendationRow): PersonalizedRecommendation {
  if (!row.title || (!row.content_id && !row.id)) {
    throw new Error("Recommendation service returned an invalid row");
  }
  const type = normalizeType(row);
  const genres = labels(row.genres);
  const themes = labels(row.themes);
  const rating = number(row.rating_average);
  const popularity = number(row.popularity_score);
  const finalScore = number(row.final_score);
  return {
    id: String(row.content_id ?? row.id),
    externalId: String(row.external_id ?? row.content_id ?? row.id),
    provider: row.source?.toUpperCase() === "MAL" ? "mal" : row.source?.toUpperCase() === "JIKAN" ? "jikan" : "tmdb",
    type,
    title: row.title,
    originalTitle: row.original_title ?? undefined,
    description: row.overview ?? "",
    posterUrl: row.poster_url ?? "",
    backdropUrl: row.backdrop_url ?? row.poster_url ?? "",
    genres,
    themes,
    language: row.original_language ?? "Unknown",
    country: first(row.country),
    releaseYear: number(row.release_year),
    director: first(row.director, "") || undefined,
    cast: labels(row.cast),
    rating,
    popularity,
    match: Math.round(Math.max(0, Math.min(100, finalScore * 100))),
    reason: row.reason ?? "Personalized from your entertainment activity.",
    recommendationStrategy: row.strategy ?? "personalized_hybrid",
    scores: {
      content: number(row.content_score),
      collaborative: number(row.collaborative_score),
      context: number(row.context_score),
      final: finalScore,
    },
  };
}

export async function requestPersonalizedRecommendations(
  input: {
    userId?: string;
    query?: string;
    limit?: number;
    contentType?: string;
    seriesType?: string;
  },
  options: {
    config?: RecommendationServiceConfig;
    fetchImplementation?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<PersonalizedRecommendation[]> {
  const config = options.config ?? createRecommendationServiceConfig();
  if (!config.isConfigured) throw new Error("Recommendation service is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);
  try {
    const response = await (options.fetchImplementation ?? fetch)(config.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        user_id: input.userId ?? null,
        query: input.query ?? null,
        limit: Math.min(Math.max(input.limit ?? 12, 1), 50),
        content_type: input.contentType ?? null,
        series_type: input.seriesType ?? null,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Recommendation service returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Recommendation service returned invalid JSON");
    return payload.map((row) => mapRecommendationRow(row as RecommendationRow));
  } finally {
    clearTimeout(timeout);
  }
}
