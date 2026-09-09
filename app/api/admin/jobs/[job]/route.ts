import { isAdminContext, requireAdmin } from "@/lib/admin";
import { getEnvironmentValue } from "@/lib/env";
import { logStructured, safeErrorType } from "@/lib/observability";

const allowedJobs = new Set(["daily_content_sync", "weekly_analytics", "cleanup"]);

export async function POST(request: Request, context: { params: Promise<{ job: string }> }) {
  const admin = await requireAdmin(request);
  if (!isAdminContext(admin)) return admin;
  const { job } = await context.params;
  if (!allowedJobs.has(job)) return Response.json({ error: "Unknown job" }, { status: 404 });
  const workerUrl = getEnvironmentValue("WORKER_API_URL").replace(/\/$/, "");
  const workerKey = getEnvironmentValue("WORKER_API_KEY");
  if (!workerUrl || !workerKey) return Response.json({ error: "Worker service is not configured" }, { status: 503 });
  try {
    const response = await fetch(`${workerUrl}/jobs/${job}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${workerKey}` },
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Worker returned ${response.status}`);
    logStructured("info", "pipeline", "admin_job_triggered", { job, userId: admin.userId });
    return Response.json({ data: payload });
  } catch (error) {
    logStructured("error", "pipeline", "admin_job_trigger_failed", { job, errorType: safeErrorType(error) });
    return Response.json({ error: "Worker job could not be started" }, { status: 503 });
  }
}
