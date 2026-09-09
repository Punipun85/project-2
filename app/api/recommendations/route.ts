import { contentTypes, type ContentType, type EntertainmentContent } from "@/lib/content-types";
import { defaultProfile, rankForUser } from "@/lib/recommendation";
import { mapRecommendationRow, requestPersonalizedRecommendations } from "@/lib/recommendation-client";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";
import { logStructured } from "@/lib/observability";

async function recordRecommendation(
  supabase: ReturnType<typeof createSupabaseConfig>,
  token: string | undefined,
  strategy: string,
  rows: Array<{ scores?: { final?: number } }>,
) {
  if (!supabase.isConfigured) return;
  const scores = rows.map((row) => Number(row.scores?.final)).filter(Number.isFinite);
  const averageScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  const response = await restFetch(supabase, token ?? supabase.anonKey, "rpc/record_recommendation_request", {
    method: "POST",
    body: JSON.stringify({ p_strategy: strategy, p_result_count: rows.length, p_average_score: averageScore }),
  }).catch(() => null);
  if (!response?.ok) logStructured("warn", "database", "recommendation_metric_store_failed", { strategy });
}

async function fetchSupabaseRecommendationPool(
  supabase: ReturnType<typeof createSupabaseConfig>,
  token: string | undefined,
  type: ContentType | undefined,
): Promise<EntertainmentContent[]> {
  if (!supabase.isConfigured) {
    throw new Error("Supabase is not configured for recommendation fallback");
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
      "original_language",
      "country",
      "release_year",
      "director",
      "cast",
      "genres",
      "themes",
      "rating_average",
      "popularity_score",
    ].join(","),
    order: "popularity_score.desc.nullslast",
    limit: "100",
  });

  if (type) {
    query.set("content_type", `eq.${type === "kdrama" ? "series" : type}`);
    if (type === "kdrama") query.set("series_type", "eq.kdrama");
  }

  const response = await restFetch(supabase, token ?? supabase.anonKey, `contents?${query}`);
  if (!response.ok) {
    throw new Error(`Supabase recommendation fallback returned HTTP ${response.status}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error("Supabase recommendation fallback returned invalid JSON");
  }

  return rows.map((row) => mapRecommendationRow(row));
}

function normalizeProfileType(value: string): ContentType | null {
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "movie") return "movie";
  if (normalized === "anime") return "anime";
  if (normalized === "series" || normalized === "tvseries" || normalized === "tvshow") return "series";
  if (normalized === "kdrama" || normalized === "korean drama") return "kdrama";
  if (normalized === "documentary") return "documentary";
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const contextQuery = url.searchParams.get("query")?.trim().slice(0, 500) || undefined;
  const requestedLimit = Number(url.searchParams.get("limit") ?? 12);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 24)
    : 12;

  if (typeParam && !contentTypes.includes(typeParam as ContentType)) {
    return Response.json({ error: "Unsupported content type" }, { status: 400 });
  }

  let profile = defaultProfile;
  let personalized = false;
  const supabase = createSupabaseConfig();
  const session = await requireSupabaseUser(request, supabase);

  const remoteContentType = typeParam === "kdrama" ? "series" : typeParam ?? undefined;
  const remoteSeriesType = typeParam === "kdrama" ? "kdrama" : undefined;
  try {
    const recommendations = await requestPersonalizedRecommendations({
      userId: session?.user.id,
      query: contextQuery,
      limit,
      contentType: remoteContentType,
      seriesType: remoteSeriesType,
    });
    if (recommendations.length) {
      const strategy = recommendations[0].recommendationStrategy;
      await recordRecommendation(supabase, session?.token, strategy, recommendations);
      return Response.json({
        data: recommendations,
        meta: {
          model: "personalized-hybrid-v2",
          engine: "standalone-python-recommendation-service",
          personalized: strategy === "personalized_hybrid",
          coldStart: strategy === "cold_start_trending",
          fallbackUsed: false,
          weights: { content: 0.5, collaborative: 0.3, context: 0.2 },
        },
      });
    }
  } catch {
    // Preserve the existing TypeScript ranker when the Python service is not
    // configured or temporarily unavailable.
  }

  if (session) {
    const query = new URLSearchParams({ select: "favorite_genres,favorite_types,favorite_moods", id: `eq.${session.user.id}`, limit: "1" });
    const response = await restFetch(supabase, session.token, `user_profiles?${query}`);
    const rows = response.ok ? await response.json() as Array<Record<string, string[]>> : [];
    if (rows[0]) {
      profile = {
        ...defaultProfile,
        favoriteGenres: rows[0].favorite_genres ?? defaultProfile.favoriteGenres,
        favoriteContentTypes: (rows[0].favorite_types ?? []).map((value) => normalizeProfileType(value)).filter(Boolean) as ContentType[],
        themes: rows[0].favorite_moods ?? defaultProfile.themes,
      };
      personalized = true;
    }
  }

  const items = await fetchSupabaseRecommendationPool(supabase, session?.token, typeParam as ContentType | undefined);
  const recommendations = rankForUser(items, profile, limit).map((result) => ({
    ...result.content,
    scores: {
      content: Number(result.contentScore.toFixed(4)),
      collaborative: Number(result.collaborativeScore.toFixed(4)),
      final: Number(result.finalScore.toFixed(4)),
    },
    reason: result.reason,
  }));

  await recordRecommendation(supabase, session?.token, personalized ? "typescript_personalized_fallback" : "cold_start_trending", recommendations);

  return Response.json({
    data: recommendations,
    meta: {
      model: "universal-hybrid-v1",
      engine: "typescript-fallback",
      personalized,
      fallbackUsed: true,
      weights: { content: 0.6, collaborative: 0.4 },
    },
  });
}
