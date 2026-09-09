import { isAdminContext, requireAdmin } from "@/lib/admin";
import { getEnvironmentValue } from "@/lib/env";
import { logStructured, safeErrorType } from "@/lib/observability";
import { validateProductionEnvironment } from "@/lib/production-config";
import { restFetch } from "@/lib/supabase/server";

type Probe = { serviceName: string; status: "healthy" | "degraded" | "down"; latencyMs: number; checkedAt: string; detail?: string };

async function probe(serviceName: string, url: string, headers: HeadersInit = {}): Promise<Probe> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    if (!url) throw new Error("not_configured");
    const response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    return { serviceName, status: response.ok ? "healthy" : "degraded", latencyMs: Math.round(performance.now() - started), checkedAt: new Date().toISOString(), detail: `HTTP ${response.status}` };
  } catch (error) {
    return { serviceName, status: "down", latencyMs: Math.round(performance.now() - started), checkedAt: new Date().toISOString(), detail: safeErrorType(error) };
  } finally { clearTimeout(timeout); }
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!isAdminContext(admin)) return admin;
  const embeddingBase = getEnvironmentValue("EMBEDDING_API_URL").replace(/\/ai\/embed\/?$/, "");
  const recommendationUrl = getEnvironmentValue("RECOMMENDATION_API_URL");
  const recommendationBase = recommendationUrl.replace(/\/recommendations\/?$/, "");
  const databaseUrl = `${admin.config.url}/rest/v1/contents?select=id&limit=1`;
  const probes = await Promise.all([
    probe("Embedding Service", `${embeddingBase}/health`),
    probe("Recommendation Service", `${recommendationBase}/health`),
    probe("Database", databaseUrl, { apikey: admin.config.anonKey, authorization: `Bearer ${admin.token}` }),
  ]);
  await Promise.all(probes.map(async (item) => {
    const response = await restFetch(admin.config, admin.token, "rpc/record_service_health", {
      method: "POST",
      body: JSON.stringify({ p_service_name: item.serviceName, p_status: item.status, p_latency_ms: item.latencyMs, p_details: { detail: item.detail } }),
    });
    if (!response.ok) logStructured("warn", "database", "health_sample_store_failed", { service: item.serviceName, status: response.status });
  }));
  return Response.json({ data: probes, environment: validateProductionEnvironment() });
}
