import { getContentById } from "@/lib/content-service";
import { requestPersonalizedRecommendations } from "@/lib/recommendation-client";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { searchVectorContents } from "@/lib/vector-search";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const content = await getContentById(id);
  if (!content) return Response.json({ error: "Content not found" }, { status: 404 });
  const session = await requireSupabaseUser(request, createSupabaseConfig());
  const query = [content.title, content.type, ...content.genres, ...content.themes].join(" ");
  const serviceType = content.type === "kdrama" ? "series" : content.type;
  const seriesType = content.type === "kdrama" ? "kdrama" : undefined;

  try {
    const rows = await requestPersonalizedRecommendations({
      userId: session?.user.id,
      query,
      limit: 12,
      contentType: serviceType,
      seriesType,
    });
    return Response.json({
      data: rows.filter((item) => item.id !== content.id).slice(0, 10),
      meta: { engine: "personalized-hybrid", basis: content.title },
    });
  } catch {
    try {
      const rows = await searchVectorContents(query, 12, {
        contentType: serviceType,
        seriesType,
        minSimilarity: 0.05,
      });
      return Response.json({
        data: rows.map((row) => row.content).filter((item) => item.id !== content.id).slice(0, 10),
        meta: { engine: "pgvector-similarity", basis: content.title },
      });
    } catch {
      return Response.json({ data: [], meta: { engine: "unavailable", basis: content.title } });
    }
  }
}
