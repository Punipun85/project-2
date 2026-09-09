import { logStructured } from "@/lib/observability";
import { checkRateLimit, clientAddress, rateLimitResponse } from "@/lib/security/rate-limit";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";

export type AdminContext = {
  config: ReturnType<typeof createSupabaseConfig>;
  token: string;
  userId: string;
};

export async function requireAdmin(request: Request): Promise<AdminContext | Response> {
  const rate = checkRateLimit(`admin:${clientAddress(request)}`, 60, 60_000);
  if (!rate.allowed) {
    logStructured("warn", "security", "admin_rate_limited");
    return rateLimitResponse(rate);
  }
  const config = createSupabaseConfig();
  if (!config.isConfigured) return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const response = await restFetch(config, session.token, "rpc/is_catalog_admin", {
    method: "POST",
    body: "{}",
  });
  const isAdmin = response.ok && (await response.json()) === true;
  if (!isAdmin) {
    logStructured("warn", "security", "admin_access_denied", { userId: session.user.id });
    return Response.json({ error: "Admin role required" }, { status: 403 });
  }
  return { config, token: session.token, userId: session.user.id };
}

export function isAdminContext(value: AdminContext | Response): value is AdminContext {
  return !(value instanceof Response);
}
