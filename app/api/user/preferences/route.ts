import { PERSONALIZATION_GENRES, refreshUserPersonalization } from "@/lib/personalization";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";

const GENRES = [...PERSONALIZATION_GENRES];
const TYPES = ["Movie", "Anime", "Series"];
const MOODS = ["Dark", "Emotional", "Funny", "Relaxing"];
const clean = (value: unknown, allowed: string[]) =>
  Array.isArray(value) ? [...new Set(value.map(String).filter((item) => allowed.includes(item)))] : [];

export async function GET(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const query = new URLSearchParams({ select: "*", user_id: `eq.${session.user.id}`, limit: "1" });
  const response = await restFetch(config, session.token, `user_preferences?${query}`);
  const payload = response.ok ? await response.json() : [];
  return Response.json({ data: payload[0] ?? null }, { status: response.status });
}

export async function PUT(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid preferences" }, { status: 400 });
  const favoriteGenres = clean(body.favoriteGenres, GENRES);
  if (favoriteGenres.length < 3) {
    return Response.json({ error: "Select at least 3 favorite genres" }, { status: 400 });
  }
  const values = {
    user_id: session.user.id,
    favorite_genres: favoriteGenres,
    favorite_types: clean(body.favoriteTypes, TYPES),
    favorite_moods: clean(body.favoriteMoods, MOODS),
    disliked_genres: clean(body.dislikedGenres, GENRES),
    onboarding_completed: body.onboardingCompleted !== false,
  };
  const response = await restFetch(config, session.token, "user_preferences?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(values),
  });
  if (!response.ok) return Response.json({ error: await response.json().catch(() => null) }, { status: response.status });
  await restFetch(config, session.token, "user_profiles?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: session.user.id,
      username: typeof body.username === "string" ? body.username.trim().slice(0, 60) : null,
      favorite_genres: values.favorite_genres,
      favorite_types: values.favorite_types,
      favorite_moods: values.favorite_moods,
      onboarding_completed: values.onboarding_completed,
    }),
  });
  const personalization = await refreshUserPersonalization(config, session.token, session.user.id);
  const payload = await response.json();
  return Response.json({ data: payload[0] ?? values, personalization });
}
