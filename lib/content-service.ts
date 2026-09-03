import { and, desc, eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { contents } from "@/db/schema";
import { catalog, type ContentType, type EntertainmentContent } from "./catalog";
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

function normalizeSupabaseType(value: unknown): ContentType {
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

function toContent(row: typeof contents.$inferSelect): EntertainmentContent {
  return {
    id: String(row.id),
    externalId: row.externalId,
    provider: row.provider === "jikan" ? "jikan" : row.provider === "internal" ? "internal" : "tmdb",
    type: row.type,
    title: row.title,
    originalTitle: row.originalTitle ?? undefined,
    description: row.description,
    posterUrl: row.posterUrl ?? "",
    backdropUrl: row.backdropUrl ?? row.posterUrl ?? "",
    genres: parseArray(row.genre),
    themes: parseArray(row.themes),
    language: row.language ?? "Unknown",
    country: row.country ?? "Unknown",
    releaseYear: Number(row.releaseDate?.slice(0, 4) ?? 0),
    duration: row.duration ?? undefined,
    episodes: row.episodes ?? undefined,
    season: row.season ?? undefined,
    studio: row.studio ?? undefined,
    sourceMaterial: row.sourceMaterial ?? undefined,
    director: row.director ?? undefined,
    cast: parseArray(row.cast),
    rating: row.rating,
    popularity: row.popularity,
    match: Math.round(Math.min(99, row.rating * 10 + row.popularity * 0.08)),
    reason: `Recommended because it matches your ${row.type} and ${parseArray(row.genre)[0] ?? "story"} preferences.`,
  };
}

type SupabaseContentRow = {
  id: number | string;
  external_id: string;
  source: string;
  content_type: string;
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
  episodes?: number | null;
  season_number?: number | null;
  studio?: unknown;
  director?: unknown;
  cast?: unknown;
  rating_average?: number | null;
  popularity_score?: number | null;
};

function toSupabaseContent(row: SupabaseContentRow): EntertainmentContent {
  const genres = parseUnknownArray(row.genres);
  const themes = parseUnknownArray(row.themes);
  const rating = Number(row.rating_average ?? 0);
  const popularity = Number(row.popularity_score ?? 0);

  return {
    id: String(row.id),
    externalId: String(row.external_id),
    provider: row.source?.toUpperCase() === "JIKAN" ? "jikan" : "tmdb",
    type: normalizeSupabaseType(row.content_type),
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
    episodes: row.episodes ?? undefined,
    season: row.season_number ? `Season ${row.season_number}` : undefined,
    studio: parseUnknownText(row.studio),
    director: parseUnknownText(row.director),
    cast: parseUnknownArray(row.cast),
    rating,
    popularity,
    match: Math.round(Math.min(99, rating * 10 + popularity * 0.08)),
    reason: `Recommended because it matches your ${normalizeSupabaseType(row.content_type)} and ${genres[0] ?? "story"} preferences.`,
  };
}

async function listSupabaseContents(
  filters: ContentFilters,
  limit: number,
): Promise<EntertainmentContent[]> {
  const config = createSupabaseConfig();
  if (!config.isConfigured) return [];

  const query = new URLSearchParams({
    select: [
      "id",
      "external_id",
      "source",
      "content_type",
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
      "episodes",
      "season_number",
      "studio",
      "director",
      "cast",
      "rating_average",
      "popularity_score",
    ].join(","),
    order: "popularity_score.desc.nullslast",
    limit: String(Math.max(limit, 100)),
  });

  if (filters.type) {
    const remoteType = filters.type === "series" ? "tv_series" : filters.type;
    query.set("content_type", `eq.${remoteType}`);
  }

  const response = await fetch(`${config.url}/rest/v1/contents?${query}`, {
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${config.anonKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) return [];

  const rows = (await response.json()) as SupabaseContentRow[];
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
    if (supabaseItems.length) return supabaseItems;
  } catch {
    // Fall back to D1 or the curated catalog when Supabase is unavailable.
  }

  try {
    const db = getDb();
    const where = and(
      filters.type ? eq(contents.type, filters.type) : undefined,
      filters.search ? like(contents.title, `%${filters.search}%`) : undefined,
    );
    const rows = await db
      .select()
      .from(contents)
      .where(where)
      .orderBy(desc(contents.popularity))
      .limit(limit);
    if (rows.length) return rows.map(toContent);
  } catch {
    // Local preview and a fresh deployment can use the curated catalog until sync runs.
  }

  return catalog
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

export async function getContentById(id: string): Promise<EntertainmentContent | null> {
  const numericId = Number(id);
  if (Number.isInteger(numericId)) {
    try {
      const db = getDb();
      const rows = await db.select().from(contents).where(eq(contents.id, numericId)).limit(1);
      if (rows[0]) return toContent(rows[0]);
    } catch {
      // Fall through to curated catalog.
    }
  }

  return catalog.find((content) => content.id === id) ?? null;
}
