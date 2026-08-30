import { and, desc, eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { contents } from "@/db/schema";
import { catalog, type ContentType, type EntertainmentContent } from "./catalog";

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

export async function listContents(filters: ContentFilters = {}): Promise<EntertainmentContent[]> {
  const limit = Math.min(Math.max(filters.limit ?? 24, 1), 100);
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
