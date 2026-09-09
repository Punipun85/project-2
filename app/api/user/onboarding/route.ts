import { PERSONALIZATION_GENRES, refreshUserPersonalization } from "@/lib/personalization";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";

const GENRES = [...PERSONALIZATION_GENRES];

type InitialRating = { contentId?: number; rating?: number };

export async function GET(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const [preferenceResponse, contentResponse] = await Promise.all([
    restFetch(config, session.token, `user_preferences?select=onboarding_completed,favorite_genres&user_id=eq.${session.user.id}&limit=1`),
    restFetch(
      config,
      session.token,
      "contents?select=id,title,overview,poster_url,content_type,genres,rating_average,release_year&is_active=eq.true&order=popularity_score.desc.nullslast&limit=8",
    ),
  ]);
  const preferences = preferenceResponse.ok ? await preferenceResponse.json() : [];
  const contents = contentResponse.ok ? await contentResponse.json() : [];
  return Response.json({
    data: {
      completed: preferences[0]?.onboarding_completed ?? false,
      favoriteGenres: preferences[0]?.favorite_genres ?? [],
      genres: GENRES,
      contents,
    },
  });
}

export async function POST(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as
    | { favoriteGenres?: unknown; ratings?: InitialRating[] }
    | null;
  const favoriteGenres = Array.isArray(body?.favoriteGenres)
    ? [...new Set(body.favoriteGenres.map(String).filter((genre) => GENRES.some((allowed) => allowed === genre)))]
    : [];
  const ratings = Array.from(
    new Map(
      (body?.ratings ?? [])
        .filter(
          (item) =>
            Number.isInteger(item.contentId) &&
            Number(item.contentId) > 0 &&
            Number.isFinite(Number(item.rating)) &&
            Number(item.rating) >= 1 &&
            Number(item.rating) <= 5,
        )
        .map((item) => [Number(item.contentId), Number(item.rating)]),
    ),
    ([contentId, rating]) => ({ content_id: contentId, rating }),
  );
  if (favoriteGenres.length < 3) {
    return Response.json({ error: "Select at least 3 favorite genres" }, { status: 400 });
  }
  if (ratings.length < 5) {
    return Response.json({ error: "Rate at least 5 titles" }, { status: 400 });
  }

  const preferenceResponse = await restFetch(
    config,
    session.token,
    "user_preferences?on_conflict=user_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: session.user.id,
        favorite_genres: favoriteGenres,
        onboarding_completed: false,
      }),
    },
  );
  if (!preferenceResponse.ok) {
    return Response.json({ error: "Could not save onboarding preferences" }, { status: preferenceResponse.status });
  }
  const ratingRows = ratings.map((item) => ({ ...item, user_id: session.user.id }));
  const ratingsResponse = await restFetch(
    config,
    session.token,
    "ratings?on_conflict=user_id,content_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(ratingRows),
    },
  );
  if (!ratingsResponse.ok) {
    return Response.json({ error: "Could not save initial ratings" }, { status: ratingsResponse.status });
  }
  const completionResponse = await restFetch(
    config,
    session.token,
    "user_preferences?on_conflict=user_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: session.user.id,
        favorite_genres: favoriteGenres,
        onboarding_completed: true,
      }),
    },
  );
  if (!completionResponse.ok) {
    return Response.json({ error: "Could not complete onboarding" }, { status: completionResponse.status });
  }
  await Promise.all([
    restFetch(config, session.token, "user_profiles?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: session.user.id, favorite_genres: favoriteGenres, onboarding_completed: true }),
    }),
    restFetch(config, session.token, "user_interactions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(
        ratingRows.map((item) => ({
          ...item,
          interaction_type: "rating",
          metadata: { source: "onboarding" },
        })),
      ),
    }),
  ]);
  const personalization = await refreshUserPersonalization(config, session.token, session.user.id);
  return Response.json({ success: true, personalization });
}
