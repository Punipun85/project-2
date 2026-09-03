import { env } from "cloudflare:workers";

import { createSupabaseConfig, type SupabaseEnvironment } from "@/lib/supabase/config";
import {
  requireSupabaseUser,
  resolveContentId,
  restFetch,
} from "@/lib/supabase/server";

const eventTypes = new Set(["view", "click", "watchlist", "complete", "rating", "search", "chat"]);

export async function POST(request: Request) {
  const supabase = createSupabaseConfig(env as unknown as SupabaseEnvironment);
  const session = await requireSupabaseUser(request, supabase);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as
    | {
        eventType?: string;
        contentId?: number;
        externalId?: string;
        provider?: string;
        rating?: number;
        metadata?: Record<string, unknown>;
      }
    | null;
  const eventType = body?.eventType?.trim().toLowerCase() ?? "";
  if (!eventTypes.has(eventType)) {
    return Response.json({ error: "Unsupported event type" }, { status: 400 });
  }
  const contentId = body
    ? await resolveContentId(supabase, session.token, body)
    : null;
  if (!contentId && !["search", "chat"].includes(eventType)) {
    return Response.json({ error: "Content was not found" }, { status: 404 });
  }
  const metadata = { ...(body?.metadata ?? {}) };
  if (typeof metadata.query === "string") metadata.query = metadata.query.slice(0, 500);
  const rating = eventType === "rating" ? Number(body?.rating) : null;
  if (eventType === "rating" && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
    return Response.json({ error: "Rating must be from 1 to 5" }, { status: 400 });
  }
  const response = await restFetch(supabase, session.token, "user_interactions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: session.user.id,
      content_id: contentId,
      interaction_type: eventType,
      rating,
      metadata,
    }),
  });
  return Response.json({ success: response.ok }, { status: response.ok ? 201 : response.status });
}
