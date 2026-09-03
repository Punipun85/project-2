import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";

const allowedGenres = new Set(["Action", "Romance", "Fantasy", "Sci-Fi", "Horror", "Comedy"]);
const allowedTypes = new Set(["Movie", "Anime", "Series"]);
const allowedMoods = new Set(["Dark", "Emotional", "Funny", "Relaxing"]);
const cleanList = (value: unknown, allowed: Set<string>) =>
  Array.isArray(value) ? value.map(String).filter((item) => allowed.has(item)) : [];

export async function GET(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const query = new URLSearchParams({ select: "*", id: `eq.${session.user.id}`, limit: "1" });
  const response = await restFetch(config, session.token, `user_profiles?${query}`);
  const rows = response.ok ? await response.json() : [];
  return Response.json({ data: rows[0] ?? null });
}

export async function PUT(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid profile" }, { status: 400 });
  const profile = {
    id: session.user.id,
    username: typeof body.username === "string" ? body.username.trim().slice(0, 60) : null,
    avatar_url: typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : null,
    favorite_genres: cleanList(body.favoriteGenres, allowedGenres),
    favorite_types: cleanList(body.favoriteTypes, allowedTypes),
    favorite_moods: cleanList(body.favoriteMoods, allowedMoods),
    onboarding_completed: body.onboardingCompleted === true,
  };
  const response = await restFetch(config, session.token, "user_profiles?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(profile),
  });
  const payload = await response.json().catch(() => null);
  return Response.json(response.ok ? { data: payload?.[0] ?? profile } : { error: payload }, { status: response.status });
}
