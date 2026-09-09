"use client";

import { Activity, AlertTriangle, BarChart3, Clock3, Database, Film, Gauge, HeartPulse, RefreshCw, Star, Tv, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type RankRow = Record<string, unknown>;
type JobRow = { id: number; job_name: string; status: string; started_at: string };
type Dashboard = {
  summary?: Record<string, unknown>;
  content?: { missingMetadata?: number; missingEmbeddings?: number; mostWatched?: RankRow[]; highestRated?: RankRow[]; trendingGenres?: RankRow[] };
  users?: Record<string, unknown>;
  recommendations?: Record<string, unknown>;
  jobs?: JobRow[];
};
type Health = { serviceName: string; status: string; latencyMs: number; checkedAt: string; detail?: string };

const number = (value: unknown) => new Intl.NumberFormat("en-US", { notation: Number(value) > 9999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value ?? 0));

export function AdminDashboard({ monitoringOnly = false }: { monitoringOnly?: boolean }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [health, setHealth] = useState<Health[]>([]);
  const [environment, setEnvironment] = useState<{ valid: boolean; missing: string[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [dashboardResponse, healthResponse] = await Promise.all([
      fetch("/api/admin/dashboard", { cache: "no-store" }),
      fetch("/api/admin/health", { cache: "no-store" }),
    ]);
    if (dashboardResponse.status === 401) { window.location.href = "/login?next=/admin"; return; }
    if (dashboardResponse.status === 403) { setError("This area requires the Supabase admin role."); setLoading(false); return; }
    if (!dashboardResponse.ok) { setError("Production analytics are temporarily unavailable."); setLoading(false); return; }
    const dashboardPayload = await dashboardResponse.json();
    const healthPayload = healthResponse.ok ? await healthResponse.json() : { data: [] };
    setData(dashboardPayload.data);
    setHealth(healthPayload.data ?? []);
    setEnvironment(healthPayload.environment ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) return <AdminShell><div className="admin-loading"><RefreshCw className="spin" /> Loading production telemetry…</div></AdminShell>;
  if (error) return <AdminShell><div className="admin-error"><AlertTriangle /><h2>Access unavailable</h2><p>{error}</p><Link href="/dashboard">Return to NexaPlay</Link></div></AdminShell>;

  const summary = data?.summary ?? {};
  const cards = [
    ["Total Users", summary.totalUsers, Users], ["Total Contents", summary.totalContents, Database],
    ["Movies", summary.movies, Film], ["Series", summary.series, Tv], ["Anime", summary.anime, Activity],
    ["Ratings", summary.ratings, Star], ["Watch Activity", summary.watchActivity, Gauge],
  ] as const;

  return <AdminShell>
    <header className="admin-header">
      <div><span>PRODUCTION CONTROL</span><h1>{monitoringOnly ? "Service monitoring" : "NexaPlay operations"}</h1><p>Live operational health, audience signals, and automation status.</p></div>
      <button onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
    </header>

    <nav className="admin-tabs"><Link className={!monitoringOnly ? "active" : ""} href="/admin">Overview</Link><Link className={monitoringOnly ? "active" : ""} href="/admin/monitoring">Monitoring</Link><Link href="/dashboard">Open app</Link></nav>

    {!monitoringOnly && <>
      <section className="admin-stat-grid">{cards.map(([label, value, Icon]) => <article key={label}><Icon /><span>{label}</span><strong>{number(value)}</strong></article>)}</section>
      <section className="admin-grid">
        <Panel title="Content analytics" icon={BarChart3}>
          <Metric label="Missing metadata" value={data?.content?.missingMetadata} warning />
          <Metric label="Missing embeddings" value={data?.content?.missingEmbeddings} warning />
          <RankList title="Most watched" rows={data?.content?.mostWatched} valueKey="watch_count" />
          <RankList title="Highest rated" rows={data?.content?.highestRated} valueKey="average_rating" />
        </Panel>
        <Panel title="User analytics" icon={Users}>
          <Metric label="Active users · 30d" value={data?.users?.active30d} />
          <Metric label="New users · 30d" value={data?.users?.new30d} />
          <Metric label="Retention" value={`${number(data?.users?.retentionPercent)}%`} />
          <Metric label="Average rating" value={data?.users?.averageRating} />
          <Metric label="Watch time" value={`${number(data?.users?.watchMinutes)} min`} />
          <RankList title="Trending genres" rows={data?.content?.trendingGenres} nameKey="genre" valueKey="activity" />
        </Panel>
        <Panel title="Recommendation analytics" icon={Gauge}>
          <Metric label="Generated" value={data?.recommendations?.generated} />
          <Metric label="Results served" value={data?.recommendations?.resultsServed} />
          <Metric label="Clicks" value={data?.recommendations?.clicks} />
          <Metric label="Views" value={data?.recommendations?.views} />
          <Metric label="CTR" value={`${number(data?.recommendations?.ctr)}%`} />
          <Metric label="Average score" value={data?.recommendations?.averageScore} />
        </Panel>
      </section>
    </>}

    <section className="admin-grid admin-monitor-grid">
      <Panel title="Service health" icon={HeartPulse}>
        {health.length ? health.map((item) => <div className="service-row" key={item.serviceName}><i className={item.status} /><div><strong>{item.serviceName}</strong><small>{item.detail} · {new Date(item.checkedAt).toLocaleTimeString()}</small></div><b>{item.latencyMs} ms</b></div>) : <p className="admin-empty">No health samples yet.</p>}
      </Panel>
      <Panel title="Environment readiness" icon={Database}>
        <div className={`environment-state ${environment?.valid ? "ready" : "warning"}`}><strong>{environment?.valid ? "Production configuration complete" : "Configuration needs attention"}</strong><p>{environment?.valid ? "All required service variables are available." : `Missing: ${environment?.missing?.join(", ") || "unknown"}`}</p></div>
      </Panel>
      <Panel title="Recent automation" icon={Clock3}>
        {(data?.jobs ?? []).length ? data!.jobs!.slice(0, 8).map((job) => <div className="job-row" key={job.id}><div><strong>{job.job_name.replaceAll("_", " ")}</strong><small>{new Date(job.started_at).toLocaleString()}</small></div><span className={job.status}>{job.status}</span></div>) : <p className="admin-empty">The worker has not recorded a job yet.</p>}
      </Panel>
    </section>
  </AdminShell>;
}

function AdminShell({ children }: { children: React.ReactNode }) { return <main className="admin-page"><div className="admin-brand"><div>N</div><strong>NexaPlay <span>AI</span></strong><small>ADMIN CONSOLE</small></div><div className="admin-content">{children}</div></main>; }
function Panel({ title, icon: Icon, children }: { title: string; icon: typeof Activity; children: React.ReactNode }) { return <article className="admin-panel"><h2><Icon size={16} />{title}</h2>{children}</article>; }
function Metric({ label, value, warning = false }: { label: string; value: unknown; warning?: boolean }) { return <div className="admin-metric"><span>{label}</span><strong className={warning && Number(value) > 0 ? "warning" : ""}>{typeof value === "string" ? value : number(value)}</strong></div>; }
function RankList({ title, rows = [], nameKey = "title", valueKey }: { title: string; rows?: RankRow[]; nameKey?: string; valueKey: string }) { return <div className="rank-list"><h3>{title}</h3>{rows.slice(0, 5).map((row, index) => <div key={`${String(row[nameKey])}-${index}`}><span>{index + 1}</span><strong>{String(row[nameKey] ?? "Unknown")}</strong><b>{number(row[valueKey])}</b></div>)}</div>; }
