import { contentTypes, type ContentType } from "@/db/schema";
import { listContents } from "@/lib/content-service";
import { defaultProfile, rankForUser } from "@/lib/recommendation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 12), 24);

  if (typeParam && !contentTypes.includes(typeParam as ContentType)) {
    return Response.json({ error: "Unsupported content type" }, { status: 400 });
  }

  const items = await listContents({ type: typeParam as ContentType | undefined, limit: 100 });
  const recommendations = rankForUser(items, defaultProfile, limit).map((result) => ({
    ...result.content,
    scores: {
      content: Number(result.contentScore.toFixed(4)),
      collaborative: Number(result.collaborativeScore.toFixed(4)),
      final: Number(result.finalScore.toFixed(4)),
    },
    reason: result.reason,
  }));

  return Response.json({
    data: recommendations,
    meta: { model: "universal-hybrid-v1", weights: { content: 0.6, collaborative: 0.4 } },
  });
}
