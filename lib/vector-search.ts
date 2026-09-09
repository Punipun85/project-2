import type { ContentType, EntertainmentContent } from "@/lib/catalog";
import {
  createEmbeddingConfig,
  EmbeddingError,
  generateEmbedding,
  type EmbeddingConfig,
} from "@/lib/embedding-client";
import { createSupabaseConfig, type SupabaseConfig } from "@/lib/supabase/config";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type VectorContentRow = {
  id: number | string;
  content_id?: number | string;
  external_id: string;
  source: string;
  title: string;
  original_title?: string | null;
  content_type: string;
  series_type?: string | null;
  overview?: string | null;
  genres?: JsonValue;
  themes?: JsonValue;
  moods?: JsonValue;
  keywords?: JsonValue;
  poster_url?: string | null;
  backdrop_url?: string | null;
  original_language?: string | null;
  country?: JsonValue;
  release_year?: number | null;
  director?: JsonValue;
  cast?: JsonValue;
  characters?: JsonValue;
  rating_average?: number | null;
  rating_count?: number | null;
  popularity_score?: number | null;
  similarity?: number | null;
};

export type VectorSearchResult = {
  content: EntertainmentContent;
  similarity: number;
  metadataScore: number;
  popularityScore: number;
  finalScore: number;
  explanation: string;
  evidence: {
    overview: string;
    genres: string[];
    themes: string[];
    moods: string[];
    keywords: string[];
    cast: string[];
    characters: string[];
  };
};

function labels(value: JsonValue | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return labels(JSON.parse(value) as JsonValue);
    } catch {
      return [value];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" || typeof item === "number") return [String(item)];
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const key of ["name", "title", "character", "actor_name", "voice_actor"]) {
        const candidate = item[key];
        if (typeof candidate === "string" && candidate.trim()) return [candidate.trim()];
      }
    }
    return [];
  });
}

function firstLabel(value: JsonValue | undefined, fallback = "Unknown"): string {
  return labels(value)[0] ?? fallback;
}

function contentType(row: VectorContentRow): ContentType {
  if (row.content_type === "series" && row.series_type === "kdrama") return "kdrama";
  if (["movie", "anime", "series", "documentary"].includes(row.content_type)) {
    return row.content_type as ContentType;
  }
  return "movie";
}

function terms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2);
}

export function metadataRelevance(row: VectorContentRow, query: string): number {
  const queryTerms = new Set(terms(query));
  if (!queryTerms.size) return 0;
  const searchable = terms(
    [
      row.title,
      row.original_title ?? "",
      row.overview ?? "",
      ...labels(row.genres),
      ...labels(row.themes),
      ...labels(row.moods),
      ...labels(row.keywords),
      ...labels(row.cast),
      ...labels(row.characters),
    ].join(" "),
  );
  const searchableTerms = new Set(searchable);
  const hits = [...queryTerms].filter((term) => searchableTerms.has(term)).length;
  const titleBoost = row.title.toLowerCase().includes(query.toLowerCase()) ? 0.35 : 0;
  return Math.min(1, hits / queryTerms.size + titleBoost);
}

function metadataQuality(row: VectorContentRow): number {
  const completeness = [
    Boolean(row.overview?.trim()),
    Boolean(row.poster_url),
    labels(row.genres).length > 0,
    labels(row.themes).length > 0,
    labels(row.characters).length > 0 || labels(row.cast).length > 0,
  ].filter(Boolean).length / 5;
  const ratingQuality = Math.max(0, Math.min(1, Number(row.rating_average ?? 0) / 10));
  return completeness * 0.7 + ratingQuality * 0.3;
}

function popularityQuality(row: VectorContentRow): number {
  const popularity = Math.max(0, Number(row.popularity_score ?? 0));
  const ratingCount = Math.max(0, Number(row.rating_count ?? 0));
  const popularitySignal = popularity / (popularity + 100);
  const audienceSignal = Math.min(1, Math.log1p(ratingCount) / Math.log(100_001));
  return popularitySignal * 0.65 + audienceSignal * 0.35;
}

function toResult(row: VectorContentRow, query: string): VectorSearchResult {
  const genres = labels(row.genres);
  const themes = labels(row.themes);
  const moods = labels(row.moods);
  const keywords = labels(row.keywords);
  const cast = labels(row.cast);
  const characters = labels(row.characters);
  const similarity = Math.max(-1, Math.min(1, Number(row.similarity ?? 0)));
  const metadataScore = metadataRelevance(row, query) * 0.55 + metadataQuality(row) * 0.45;
  const popularityScore = popularityQuality(row);
  const finalScore = Math.max(0, similarity) * 0.75 + metadataScore * 0.15 + popularityScore * 0.1;
  const type = contentType(row);
  const rating = Number(row.rating_average ?? 0);
  const popularity = Number(row.popularity_score ?? 0);
  const matchedSignals = [...genres, ...themes, ...keywords].slice(0, 3);
  const explanation = matchedSignals.length
    ? `${row.title} is semantically close to your request, supported by ${matchedSignals.join(", ")}.`
    : `${row.title} is semantically close to the meaning of your request.`;

  return {
    content: {
      id: String(row.content_id ?? row.id),
      externalId: String(row.external_id),
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
      country: firstLabel(row.country),
      releaseYear: Number(row.release_year ?? 0),
      director: firstLabel(row.director, "") || undefined,
      cast,
      rating,
      popularity,
      match: Math.round(Math.max(0, Math.min(100, finalScore * 100))),
      reason: explanation,
    },
    similarity,
    metadataScore,
    popularityScore,
    finalScore,
    explanation,
    evidence: {
      overview: row.overview ?? "",
      genres,
      themes,
      moods,
      keywords,
      cast,
      characters,
    },
  };
}

function fallbackResult(content: EntertainmentContent, query: string): VectorSearchResult & {
  queryMatched: boolean;
} {
  const queryTerms = new Set(terms(query));
  const searchable = new Set(terms([
    content.title,
    content.originalTitle ?? "",
    content.description,
    content.director ?? "",
    content.studio ?? "",
    ...content.genres,
    ...content.themes,
    ...content.cast,
  ].join(" ")));
  const hits = [...queryTerms].filter((term) => searchable.has(term)).length;
  const titleMatched = content.title.toLowerCase().includes(query.toLowerCase());
  const lexicalScore = Math.min(1, hits / Math.max(queryTerms.size, 1) + (titleMatched ? 0.35 : 0));
  const completeness = [
    Boolean(content.description),
    Boolean(content.posterUrl),
    content.genres.length > 0,
    content.themes.length > 0,
    content.cast.length > 0,
  ].filter(Boolean).length / 5;
  const metadataScore = lexicalScore * 0.65 + completeness * 0.35;
  const popularityScore = Math.max(0, Math.min(1, content.popularity / 100));
  const finalScore = metadataScore * 0.7 + popularityScore * 0.3;
  const explanation = lexicalScore > 0
    ? `${content.title} matches metadata terms in your request; semantic search is temporarily unavailable.`
    : `${content.title} is a popular catalog fallback while semantic search is temporarily unavailable.`;
  return {
    content: { ...content, match: Math.round(finalScore * 100), reason: explanation },
    similarity: 0,
    metadataScore,
    popularityScore,
    finalScore,
    explanation,
    evidence: {
      overview: content.description,
      genres: content.genres,
      themes: content.themes,
      moods: [],
      keywords: [],
      cast: content.cast,
      characters: [],
    },
    queryMatched: lexicalScore > 0,
  };
}

export function rankFallbackContents(
  contents: EntertainmentContent[],
  query: string,
  limit = 8,
  options: { requireQueryMatch?: boolean } = {},
): VectorSearchResult[] {
  return contents
    .map((content) => fallbackResult(content, query))
    .filter((result) => !options.requireQueryMatch || result.queryMatched)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, Math.min(Math.max(limit, 1), 20));
}

export type ContentRetrievalResult = {
  results: VectorSearchResult[];
  engine: "pgvector-cosine-v1" | "metadata-popularity-fallback-v1";
  fallbackUsed: boolean;
  fallbackReason: string | null;
};

export async function retrieveContentMatches(
  query: string,
  limit: number,
  options: {
    contentType?: string | null;
    seriesType?: string | null;
    minSimilarity?: number;
    embeddingConfig?: EmbeddingConfig;
    supabaseConfig?: SupabaseConfig;
    embeddingFetch?: typeof fetch;
    supabaseFetch?: typeof fetch;
    fallbackProvider: () => Promise<EntertainmentContent[]>;
    fallbackRequiresQueryMatch?: boolean;
  },
): Promise<ContentRetrievalResult> {
  try {
    return {
      results: await searchVectorContents(query, limit, options),
      engine: "pgvector-cosine-v1",
      fallbackUsed: false,
      fallbackReason: null,
    };
  } catch (error) {
    const fallbackContents = await options.fallbackProvider();
    return {
      results: rankFallbackContents(fallbackContents, query, limit, {
        requireQueryMatch: options.fallbackRequiresQueryMatch,
      }),
      engine: "metadata-popularity-fallback-v1",
      fallbackUsed: true,
      fallbackReason: error instanceof EmbeddingError
        ? error.code
        : "vector_search_error",
    };
  }
}

export async function searchVectorContents(
  query: string,
  limit = 8,
  options: {
    contentType?: string | null;
    seriesType?: string | null;
    minSimilarity?: number;
    embeddingConfig?: EmbeddingConfig;
    supabaseConfig?: SupabaseConfig;
    embeddingFetch?: typeof fetch;
    supabaseFetch?: typeof fetch;
  } = {},
): Promise<VectorSearchResult[]> {
  const vector = await generateEmbedding(query, {
    config: options.embeddingConfig ?? createEmbeddingConfig(),
    fetchImplementation: options.embeddingFetch,
  });
  const supabase = options.supabaseConfig ?? createSupabaseConfig();
  if (!supabase.isConfigured) throw new Error("Supabase is not configured");
  const response = await (options.supabaseFetch ?? fetch)(
    `${supabase.url}/rest/v1/rpc/match_contents`,
    {
      method: "POST",
      headers: {
        apikey: supabase.anonKey,
        authorization: `Bearer ${supabase.anonKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query_embedding: vector,
        match_count: Math.min(Math.max(limit * 3, 1), 60),
        filter_content_type: options.contentType ?? null,
        filter_series_type: options.seriesType ?? null,
        match_threshold: options.minSimilarity ?? 0.2,
      }),
    },
  );
  if (!response.ok) throw new Error(`Vector search returned HTTP ${response.status}`);
  const rows = (await response.json()) as VectorContentRow[];
  return rows
    .map((row) => toResult(row, query))
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, Math.min(Math.max(limit, 1), 20));
}
