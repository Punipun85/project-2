import { detectIntent } from "@/lib/recommendation";
import { listContents } from "@/lib/content-service";
import { retrieveContentMatches } from "@/lib/vector-search";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { query?: string; limit?: number }
    | null;
  const query = body?.query?.trim();

  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  const limit = Math.min(Math.max(body?.limit ?? 8, 1), 20);
  const intent = detectIntent(query);
  const requestedType = intent.contentTypes[0];
  const contentType = requestedType === "kdrama" ? "series" : requestedType ?? null;
  const seriesType = requestedType === "kdrama" ? "kdrama" : null;

  const retrieval = await retrieveContentMatches(query, limit, {
    contentType,
    seriesType,
    fallbackProvider: () => listContents({
      type: requestedType,
      limit: 100,
    }),
  });
  return Response.json({
    data: retrieval.results.map((result) => ({
      ...result.content,
      similarityScore: Number(result.similarity.toFixed(4)),
      metadataScore: Number(result.metadataScore.toFixed(4)),
      popularityScore: Number(result.popularityScore.toFixed(4)),
      finalScore: Number(result.finalScore.toFixed(4)),
      explanation: result.explanation,
      reason: result.explanation,
    })),
    intent,
    meta: {
      engine: retrieval.engine,
      fallbackUsed: retrieval.fallbackUsed,
      fallbackReason: retrieval.fallbackReason,
    },
  });
}
