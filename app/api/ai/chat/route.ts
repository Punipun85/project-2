import { env } from "cloudflare:workers";

import { listContents } from "@/lib/content-service";
import {
  buildRecommendationMessages,
  requestAIChat,
} from "@/lib/ai/client";
import { createAIConfig, type AIEnvironment } from "@/lib/ai/config";
import { classifyAITask } from "@/lib/ai/router";
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
  const candidates = matches.map((match) => ({
    title: match.content.title,
    type: match.content.type,
    genres: match.content.genres,
    themes: match.content.themes,
    reason: match.reason,
  }));
  const taskType = classifyAITask(message);
  const ai = await requestAIChat({
    config: createAIConfig(env as unknown as AIEnvironment),
    taskType,
    messages: buildRecommendationMessages(message, candidates),
  });

  return Response.json({
    answer: ai.answer ?? fallbackAnswer,
    intent,
    recommendations: matches.map((match) => ({
      id: match.content.id,
      title: match.content.title,
      type: match.content.type,
      score: Number(match.finalScore.toFixed(4)),
      reason: match.reason,
    })),
    meta: {
      provider: ai.provider,
      model: ai.model,
      taskType: ai.taskType,
      usedFallbackModel: ai.usedFallbackModel,
      errorType: ai.errorType,
      rankingEngine: "universal-hybrid-v1",
    },
  });
}
