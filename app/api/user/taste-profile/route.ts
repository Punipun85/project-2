import { refreshUserPersonalization } from "@/lib/personalization";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const [profile, embedding] = await Promise.all([
    restFetch(config, session.token, `user_taste_profiles?select=*&user_id=eq.${session.user.id}&limit=1`),
    restFetch(config, session.token, `user_embeddings?select=model,status,updated_at&user_id=eq.${session.user.id}&limit=1`),
  ]);
  const profiles = profile.ok ? await profile.json() : [];
  const embeddings = embedding.ok ? await embedding.json() : [];
  return Response.json({ data: profiles[0] ?? null, embedding: embeddings[0] ?? null });
}

export async function POST(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  return Response.json({ data: await refreshUserPersonalization(config, session.token, session.user.id) });
}
