import { createSupabaseConfig } from "@/lib/supabase/config";
import { accessToken, authFetch } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  if (!body?.password || body.password.length < 8) {
    return Response.json({ error: "Password must contain at least 8 characters." }, { status: 400 });
  }
  const token = accessToken(request);
  if (!token) return Response.json({ error: "Your reset session has expired. Request a new link." }, { status: 401 });

  const response = await authFetch(createSupabaseConfig(), "user", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: body.password }),
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) return Response.json({ error: payload.message ?? "Unable to update password." }, { status: response.status });
  return Response.json({ success: true });
}
