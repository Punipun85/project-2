import { listContents } from "@/lib/content-service";
import { askOllama } from "@/lib/ollama";
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
  const fallbackAnswer = matches.length
    ? `I found ${titles.join(", ")}. ${matches[0].reason}`
    : "I could not find a strong match yet. Try adding a mood, language, genre, or content type.";
  const ollama = await askOllama({
    message,
    candidates: matches.map((match) => ({
      title: match.content.title,
      type: match.content.type,
      genres: match.content.genres,
      themes: match.content.themes,
      reason: match.reason,
    })),
  });

  return Response.json({
    answer: ollama.answer ?? fallbackAnswer,
    intent,
    recommendations: matches.map((match) => ({
      id: match.content.id,
      title: match.content.title,
      type: match.content.type,
      score: Number(match.finalScore.toFixed(4)),
      reason: match.reason,
    })),
    meta: {
      provider: ollama.provider,
      model: ollama.model,
      rankingEngine: "universal-hybrid-v1",
    },
  });
}
