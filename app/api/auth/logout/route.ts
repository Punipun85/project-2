import { createSupabaseConfig } from "@/lib/supabase/config";
import { accessToken, authFetch, clearSessionResponse } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const config = createSupabaseConfig();
  const token = accessToken(request);
  if (token && config.isConfigured) {
    await authFetch(config, "logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => null);
  }
  return clearSessionResponse(request);
}
