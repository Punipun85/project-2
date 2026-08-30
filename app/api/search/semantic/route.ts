import { listContents } from "@/lib/content-service";
import { detectIntent, semanticSearch } from "@/lib/recommendation";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { query?: string; limit?: number }
    | null;
  const query = body?.query?.trim();

  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  const limit = Math.min(Math.max(body?.limit ?? 8, 1), 20);
  const items = await listContents({ limit: 100 });
  const intent = detectIntent(query);
  const results = semanticSearch(items, query, limit).map((result) => ({
    ...result.content,
    semanticScore: Number(result.contentScore.toFixed(4)),
    finalScore: Number(result.finalScore.toFixed(4)),
    reason: result.reason,
  }));

  return Response.json({ data: results, intent, meta: { engine: "semantic-hybrid-v1" } });
}
