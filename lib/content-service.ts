import type { ContentType, EntertainmentContent } from "./catalog";
import { getAppEnvironment } from "./env";
import { createSupabaseConfig } from "./supabase/config";

type ContentFilters = {
  type?: ContentType;
  search?: string;
  limit?: number;
};

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function parseUnknownArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") return parseArray(value);
  return [];
}

function parseUnknownText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const first = value.map(String).find((item) => item.trim());
    return first?.trim();
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    for (const key of ["name", "title", "english_name", "full_name"]) {
      if (typeof objectValue[key] === "string" && objectValue[key]?.trim()) {
        return objectValue[key] as string;
      }
    }
  }
  return undefined;
}

function normalizeSupabaseType(value: unknown, seriesType?: unknown): ContentType {
  if (String(value).toLowerCase() === "series" && String(seriesType).toLowerCase() === "kdrama") {
    return "kdrama";
  }
  switch (String(value ?? "").toLowerCase()) {
    case "anime":
      return "anime";
    case "kdrama":
      return "kdrama";
    case "tv_series":
    case "series":
      return "series";
    case "documentary":
      return "documentary";
    default:
      return "movie";
  }
}

type SupabaseContentRow = {
  id: number | string;
  external_id: string;
  source: string;
  content_type: string;
  series_type?: string | null;
  title: string;
  original_title?: string | null;
  overview?: string | null;
  poster_url?: string | null;
  backdrop_url?: string | null;
  genres?: unknown;
  themes?: unknown;
  original_language?: string | null;
  country?: unknown;
  release_year?: number | null;
  duration_minutes?: number | null;
  number_of_episodes?: number | null;
  number_of_seasons?: number | null;
  season_number?: number | null;
  studio?: unknown;
  director?: unknown;
  cast?: unknown;
  rating_average?: number | null;
  popularity_score?: number | null;
  trailer_url?: string | null;
};

export class ContentServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "not_configured" | "request_failed" | "invalid_response",
  ) {
    super(message);
    this.name = "ContentServiceError";
  }
}

function usesProductionDataPath(): boolean {
  return getAppEnvironment() === "production";
}

async function developmentCatalog(): Promise<EntertainmentContent[]> {
  if (usesProductionDataPath()) return [];
  const module = await import("./catalog");
  return module.catalog;
}

function filterContents(
  items: EntertainmentContent[],
  filters: ContentFilters,
  limit: number,
): EntertainmentContent[] {
  return items
    .filter((content) => !filters.type || content.type === filters.type)
    .filter((content) => {
      if (!filters.search) return true;
      const query = filters.search.toLowerCase();
      return [
        content.title,
        content.originalTitle ?? "",
        content.description,
        content.director ?? "",
        content.studio ?? "",
        ...content.genres,
        ...content.themes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .slice(0, limit);
}

function toSupabaseContent(row: SupabaseContentRow): EntertainmentContent {
  const genres = parseUnknownArray(row.genres);
  const themes = parseUnknownArray(row.themes);
  const rating = Number(row.rating_average ?? 0);
  const popularity = Number(row.popularity_score ?? 0);

  return {
    id: String(row.id),
    externalId: String(row.external_id),
    provider: row.source?.toUpperCase() === "MAL" ? "mal" : row.source?.toUpperCase() === "JIKAN" ? "jikan" : "tmdb",
    type: normalizeSupabaseType(row.content_type, row.series_type),
    title: row.title,
    originalTitle: row.original_title ?? undefined,
    description: row.overview ?? "",
    posterUrl: row.poster_url ?? "",
    backdropUrl: row.backdrop_url ?? row.poster_url ?? "",
    genres,
    themes,
    language: row.original_language ?? "Unknown",
    country: parseUnknownText(row.country) ?? "Unknown",
    releaseYear: Number(row.release_year ?? 0),
    duration: row.duration_minutes ?? undefined,
    episodes: row.number_of_episodes ?? undefined,
    season: row.number_of_seasons
      ? `${row.number_of_seasons} Seasons`
      : row.season_number
        ? `Season ${row.season_number}`
        : undefined,
    studio: parseUnknownText(row.studio),
    director: parseUnknownText(row.director),
    cast: parseUnknownArray(row.cast),
    rating,
    popularity,
    match: Math.round(Math.min(99, rating * 10 + popularity * 0.08)),
    reason: `Recommended because it matches your ${normalizeSupabaseType(row.content_type, row.series_type)} and ${genres[0] ?? "story"} preferences.`,
    trailerUrl: row.trailer_url ?? undefined,
  };
}

async function listSupabaseContents(
  filters: ContentFilters,
  limit: number,
): Promise<EntertainmentContent[]> {
  const config = createSupabaseConfig();
  if (!config.isConfigured) {
    throw new ContentServiceError("Supabase content storage is not configured", "not_configured");
  }

  const query = new URLSearchParams({
    select: [
      "id",
      "external_id",
      "source",
      "content_type",
      "series_type",
      "title",
      "original_title",
      "overview",
      "poster_url",
      "backdrop_url",
      "genres",
      "themes",
      "original_language",
      "country",
      "release_year",
      "duration_minutes",
      "number_of_episodes",
      "number_of_seasons",
      "season_number",
      "studio",
      "director",
      "cast",
      "rating_average",
      "popularity_score",
      "trailer_url",
    ].join(","),
    order: "popularity_score.desc.nullslast",
    limit: String(Math.max(limit, 100)),
  });

  if (filters.type) {
    const remoteType = filters.type === "kdrama" ? "series" : filters.type;
    query.set("content_type", `eq.${remoteType}`);
    if (filters.type === "kdrama") query.set("series_type", "eq.kdrama");
  }

  const response = await fetch(`${config.url}/rest/v1/contents?${query}`, {
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${config.anonKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ContentServiceError(
      `Supabase content request returned HTTP ${response.status}`,
      "request_failed",
    );
  }

  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    throw new ContentServiceError("Supabase content response is invalid", "invalid_response");
  }
  const rows = payload as SupabaseContentRow[];
  const items = rows.map(toSupabaseContent);

  return items
    .filter((content) => {
      if (!filters.search) return true;
      const queryText = filters.search.toLowerCase();
      return [
        content.title,
        content.originalTitle ?? "",
        content.description,
        content.director ?? "",
        content.studio ?? "",
        ...content.genres,
        ...content.themes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(queryText);
    })
    .slice(0, limit);
}

export async function listContents(filters: ContentFilters = {}): Promise<EntertainmentContent[]> {
  const limit = Math.min(Math.max(filters.limit ?? 24, 1), 100);
  try {
    const supabaseItems = await listSupabaseContents(filters, limit);
    if (supabaseItems.length || usesProductionDataPath()) return supabaseItems;
  } catch (error) {
    if (usesProductionDataPath()) throw error;
  }

  return filterContents(await developmentCatalog(), filters, limit);
}

export async function getContentById(id: string): Promise<EntertainmentContent | null> {
  const production = usesProductionDataPath();
  const numericId = Number(id);
  if (Number.isInteger(numericId)) {
    const config = createSupabaseConfig();
    if (!config.isConfigured) {
      if (production) {
        throw new ContentServiceError("Supabase content storage is not configured", "not_configured");
      }
    } else {
      const query = new URLSearchParams({
        select: "id,external_id,source,content_type,series_type,title,original_title,overview,poster_url,backdrop_url,genres,themes,original_language,country,release_year,duration_minutes,number_of_episodes,number_of_seasons,season_number,studio,director,cast,rating_average,popularity_score,trailer_url",
        id: `eq.${numericId}`,
        limit: "1",
      });
      try {
        const response = await fetch(`${config.url}/rest/v1/contents?${query}`, {
          headers: { apikey: config.anonKey, authorization: `Bearer ${config.anonKey}` },
          cache: "no-store",
        });
        if (response.ok) {
          const rows = (await response.json()) as SupabaseContentRow[];
          if (rows[0]) return toSupabaseContent(rows[0]);
        } else {
          throw new ContentServiceError(
            `Supabase content request returned HTTP ${response.status}`,
            "request_failed",
          );
        }
      } catch (error) {
        if (production) throw error;
      }
    }
    if (production) return null;
  }

  if (production) return null;
  const catalog = await developmentCatalog();
  const curated = catalog.find((content) => content.id === id) ?? null;
  if (curated) {
    const config = createSupabaseConfig();
    if (config.isConfigured) {
      const sourceFilter = curated.provider === "mal"
        ? "eq.MAL"
        : curated.provider === "jikan"
          ? "in.(MAL,JIKAN)"
          : "eq.TMDB";
      const query = new URLSearchParams({
        select: "id,external_id,source,content_type,series_type,title,original_title,overview,poster_url,backdrop_url,genres,themes,original_language,country,release_year,duration_minutes,number_of_episodes,number_of_seasons,season_number,studio,director,cast,rating_average,popularity_score,trailer_url",
        source: sourceFilter,
        external_id: `eq.${curated.externalId}`,
        limit: "1",
      });
      try {
        const response = await fetch(`${config.url}/rest/v1/contents?${query}`, {
          headers: { apikey: config.anonKey, authorization: `Bearer ${config.anonKey}` },
          cache: "no-store",
        });
        if (response.ok) {
          const rows = (await response.json()) as SupabaseContentRow[];
          if (rows[0]) return toSupabaseContent(rows[0]);
        }
      } catch {
        // Keep the curated record available when Supabase cannot be reached.
      }
    }
  }
  return curated;
}
