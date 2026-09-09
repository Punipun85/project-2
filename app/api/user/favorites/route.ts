import { refreshUserPersonalization } from "@/lib/personalization";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, resolveContentId, restFetch } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const query = new URLSearchParams({
    select: "id,content_id,created_at,contents(id,external_id,source,title,poster_url,backdrop_url,content_type,rating_average)",
    order: "created_at.desc",
  });
  const response = await restFetch(config, session.token, `favorites?${query}`);
  const payload = await response.json().catch(() => []);
  return Response.json(response.ok ? { data: payload } : { error: payload }, { status: response.status });
}

export async function POST(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as
    | { action?: "add" | "remove"; contentId?: number; externalId?: string; provider?: string }
    | null;
  const contentId = body ? await resolveContentId(config, session.token, body) : null;
  if (!contentId) return Response.json({ error: "Content was not found" }, { status: 404 });
  if (body?.action === "remove") {
    const query = new URLSearchParams({ user_id: `eq.${session.user.id}`, content_id: `eq.${contentId}` });
    const response = await restFetch(config, session.token, `favorites?${query}`, { method: "DELETE" });
    if (response.ok) await refreshUserPersonalization(config, session.token, session.user.id);
    return Response.json({ success: response.ok, contentId }, { status: response.ok ? 200 : response.status });
  }
  const response = await restFetch(config, session.token, "favorites?on_conflict=user_id,content_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ user_id: session.user.id, content_id: contentId }),
  });
  if (response.ok) {
    await restFetch(config, session.token, "user_interactions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: session.user.id, content_id: contentId, interaction_type: "like", metadata: { source: "favorites" } }),
    });
    await refreshUserPersonalization(config, session.token, session.user.id);
  }
  const payload = await response.json().catch(() => []);
  return Response.json(response.ok ? { data: payload, contentId } : { error: payload }, { status: response.status });
}
