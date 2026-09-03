import { contentTypes, type ContentType } from "@/db/schema";
import { listContents } from "@/lib/content-service";
import { defaultProfile, rankForUser } from "@/lib/recommendation";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 12), 24);

  if (typeParam && !contentTypes.includes(typeParam as ContentType)) {
    return Response.json({ error: "Unsupported content type" }, { status: 400 });
  }

  let profile = defaultProfile;
  let personalized = false;
  const supabase = createSupabaseConfig();
  const session = await requireSupabaseUser(request, supabase);
  if (session) {
    const query = new URLSearchParams({ select: "favorite_genres,favorite_types,favorite_moods", id: `eq.${session.user.id}`, limit: "1" });
    const response = await restFetch(supabase, session.token, `user_profiles?${query}`);
    const rows = response.ok ? await response.json() as Array<Record<string, string[]>> : [];
    if (rows[0]) {
      const typeMap: Record<string, ContentType> = { Movie: "movie", Anime: "anime", Series: "series" };
      profile = {
        ...defaultProfile,
        favoriteGenres: rows[0].favorite_genres ?? defaultProfile.favoriteGenres,
        favoriteContentTypes: (rows[0].favorite_types ?? []).map((value) => typeMap[value]).filter(Boolean),
        themes: rows[0].favorite_moods ?? defaultProfile.themes,
      };
      personalized = true;
    }
  }

  const items = await listContents({ type: typeParam as ContentType | undefined, limit: 100 });
  const recommendations = rankForUser(items, profile, limit).map((result) => ({
    ...result.content,
    scores: {
      content: Number(result.contentScore.toFixed(4)),
      collaborative: Number(result.collaborativeScore.toFixed(4)),
      final: Number(result.finalScore.toFixed(4)),
    },
    reason: result.reason,
  }));

  return Response.json({
    data: recommendations,
    meta: { model: "universal-hybrid-v1", personalized, weights: { content: 0.6, collaborative: 0.4 } },
  });
}
