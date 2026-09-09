import { createEmbeddingConfig, generateEmbedding } from "@/lib/embedding-client";
import type { SupabaseConfig } from "@/lib/supabase/config";
import { restFetch } from "@/lib/supabase/server";

type ContentMetadata = {
  title?: string;
  genres?: unknown;
  themes?: unknown;
  moods?: unknown;
};

export const PERSONALIZATION_GENRES = [
  "Action",
  "Fantasy",
  "Sci-Fi",
  "Romance",
  "Comedy",
  "Horror",
  "Drama",
  "Mystery",
] as const;

type Signal = {
  rating?: number;
  progress?: number;
  completed?: boolean;
  favorite?: boolean;
  contents?: ContentMetadata | ContentMetadata[] | null;
};

export type TasteProfile = {
  genreScores: Record<string, number>;
  styles: string[];
  sourceSummary: {
    selectedGenres: number;
    ratings: number;
    favorites: number;
    history: number;
  };
};

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
      const candidate = (item as Record<string, unknown>).name;
      return typeof candidate === "string" ? [candidate] : [];
    }
    return [];
  });
}

function content(signal: Signal): ContentMetadata {
  if (Array.isArray(signal.contents)) return signal.contents[0] ?? {};
  return signal.contents ?? {};
}

export function analyzeTasteProfile(
  favoriteGenres: string[],
  ratings: Signal[],
  favorites: Signal[],
  history: Signal[],
): TasteProfile {
  const genres = new Map<string, { label: string; score: number }>();
  const styles = new Map<string, number>();
  const add = (metadata: ContentMetadata, weight: number) => {
    for (const genre of labels(metadata.genres)) {
      const key = genre.toLowerCase();
      const current = genres.get(key) ?? { label: genre, score: 0 };
      current.score += weight;
      genres.set(key, current);
    }
    for (const style of [...labels(metadata.themes), ...labels(metadata.moods)]) {
      styles.set(style, (styles.get(style) ?? 0) + Math.max(weight, 0));
    }
  };

  for (const genre of favoriteGenres) {
    genres.set(genre.toLowerCase(), { label: genre, score: 1 });
  }
  for (const signal of ratings) {
    const rating = Math.min(Math.max(Number(signal.rating ?? 0), 1), 5);
    add(content(signal), (rating - 2.5) / 2.5);
  }
  for (const signal of favorites) add(content(signal), 0.9);
  for (const signal of history) {
    const progress = Math.min(Math.max(Number(signal.progress ?? 0), 0), 100) / 100;
    add(content(signal), 0.2 + progress * 0.6 + (signal.completed ? 0.2 : 0));
  }

  const maximum = Math.max(...Array.from(genres.values(), (item) => Math.max(item.score, 0)), 1);
  const genreScores = Object.fromEntries(
    Array.from(genres.values())
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => [item.label.toLowerCase(), Number((item.score / maximum).toFixed(4))]),
  );
  return {
    genreScores,
    styles: Array.from(styles.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([style]) => style),
    sourceSummary: {
      selectedGenres: favoriteGenres.length,
      ratings: ratings.length,
      favorites: favorites.length,
      history: history.length,
    },
  };
}

export function buildTasteDocument(profile: TasteProfile, ratings: Signal[]): string {
  const genres = Object.entries(profile.genreScores)
    .map(([genre, score]) => `${genre} ${Math.round(score * 100)}%`)
    .join(", ");
  const rated = ratings
    .filter((item) => Number(item.rating ?? 0) >= 4)
    .slice(0, 12)
    .map((item) => `${content(item).title ?? "Untitled"} ${item.rating}/5`)
    .join(", ");
  return [
    `User likes genres: ${genres || "general entertainment"}`,
    `Story styles: ${profile.styles.join(", ") || "varied"}`,
    rated ? `Highly rated: ${rated}` : "No highly rated titles yet",
  ].join("\n");
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rows(
  config: SupabaseConfig,
  token: string,
  resource: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await restFetch(config, token, resource);
  return response.ok ? ((await response.json()) as Array<Record<string, unknown>>) : [];
}

export async function refreshUserPersonalization(
  config: SupabaseConfig,
  token: string,
  userId: string,
): Promise<{ profile: TasteProfile; embeddingUpdated: boolean }> {
  const [preferenceRows, ratingRows, favoriteRows, historyRows] = await Promise.all([
    rows(config, token, `user_preferences?select=favorite_genres&user_id=eq.${userId}&limit=1`),
    rows(config, token, `ratings?select=rating,contents(title,genres,themes,moods)&user_id=eq.${userId}`),
    rows(config, token, `favorites?select=contents(title,genres,themes,moods)&user_id=eq.${userId}`),
    rows(config, token, `watch_history?select=progress,completed,contents(title,genres,themes,moods)&user_id=eq.${userId}`),
  ]);
  const selectedGenres = labels(preferenceRows[0]?.favorite_genres);
  const profile = analyzeTasteProfile(
    selectedGenres,
    ratingRows as Signal[],
    favoriteRows as Signal[],
    historyRows as Signal[],
  );
  await restFetch(config, token, "user_taste_profiles?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: userId,
      genre_scores: profile.genreScores,
      styles: profile.styles,
      source_summary: profile.sourceSummary,
      profile_version: 1,
    }),
  });

  const document = buildTasteDocument(profile, ratingRows as Signal[]);
  const sourceHash = await sha256(document);
  try {
    const embeddingConfig = createEmbeddingConfig();
    const embedding = await generateEmbedding(document, { config: embeddingConfig });
    await restFetch(config, token, "user_embeddings?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        embedding,
        model: embeddingConfig.model,
        source_hash: sourceHash,
        status: "completed",
        error: null,
      }),
    });
    return { profile, embeddingUpdated: true };
  } catch (error) {
    await restFetch(config, token, "user_embeddings?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        model: createEmbeddingConfig().model,
        source_hash: sourceHash,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "Embedding failed",
      }),
    });
    return { profile, embeddingUpdated: false };
  }
}
