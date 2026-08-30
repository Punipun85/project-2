import { listContents } from "@/lib/content-service";
import { detectIntent, semanticSearch } from "@/lib/recommendation";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { message?: string; userId?: string }
    | null;
  const message = body?.message?.trim();

  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const items = await listContents({ limit: 100 });
  const intent = detectIntent(message);
  const matches = semanticSearch(items, message, 3);
  const titles = matches.map((match) => match.content.title);
  const answer = matches.length
    ? `I found ${titles.join(", ")}. ${matches[0].reason}`
    : "I could not find a strong match yet. Try adding a mood, language, genre, or content type.";

  return Response.json({
    answer,
    intent,
    recommendations: matches.map((match) => ({
      id: match.content.id,
      title: match.content.title,
      type: match.content.type,
      score: Number(match.finalScore.toFixed(4)),
      reason: match.reason,
    })),
    meta: { provider: "local-intent-engine", llmReady: true },
  });
}
