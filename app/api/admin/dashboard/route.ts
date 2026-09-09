import { isAdminContext, requireAdmin } from "@/lib/admin";
import { logStructured, safeErrorType } from "@/lib/observability";
import { restFetch } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!isAdminContext(admin)) return admin;
  try {
    const response = await restFetch(admin.config, admin.token, "rpc/get_admin_dashboard", { method: "POST", body: "{}" });
    if (!response.ok) throw new Error(`Supabase RPC returned ${response.status}`);
    return Response.json({ data: await response.json() });
  } catch (error) {
    logStructured("error", "database", "admin_dashboard_failed", { errorType: safeErrorType(error) });
    return Response.json({ error: "Admin analytics are temporarily unavailable" }, { status: 503 });
  }
}
