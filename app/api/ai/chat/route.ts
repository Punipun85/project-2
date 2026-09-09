import {
  buildGroundedFallbackAnswer,
  buildRecommendationMessages,
  requestAIChat,
} from "@/lib/ai/client";
import { createAIConfig } from "@/lib/ai/config";
import { classifyAITask } from "@/lib/ai/router";
import { listContents } from "@/lib/content-service";
import { detectIntent } from "@/lib/recommendation";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";
import { retrieveContentMatches } from "@/lib/vector-search";

async function loadUserHistoryContext(request: Request): Promise<string | undefined> {
  const supabase = createSupabaseConfig();
  const session = await requireSupabaseUser(request, supabase);
  if (!session) return undefined;
  const query = new URLSearchParams({
    select: "interaction_type,rating,created_at,contents(title,content_type,genres,themes)",
    order: "created_at.desc",
    limit: "12",
  });
  const response = await restFetch(
    supabase,
    session.token,
    `user_interactions?${query}`,
  );
  if (!response.ok) return undefined;
  const records = (await response.json().catch(() => [])) as unknown[];
  return records.length ? JSON.stringify(records) : undefined;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { message?: string; userId?: string }
    | null;
  const message = body?.message?.trim();

  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const intent = detectIntent(message);
  const retrieval = await retrieveContentMatches(message, 5, {
    fallbackProvider: () => listContents({ limit: 100 }),
    fallbackRequiresQueryMatch: true,
  });
  const vectorMatches = retrieval.results;

  const recommendations = vectorMatches.map((match) => ({
        content: match.content,
        score: match.finalScore,
        reason: match.explanation,
        overview: match.evidence.overview,
        cast: match.evidence.cast,
        characters: match.evidence.characters,
        similarity: match.similarity,
      }));
  const candidates = recommendations.map((match) => ({
    title: match.content.title,
    type: match.content.type,
    genres: match.content.genres,
    themes: match.content.themes,
    reason: match.reason,
    overview: match.overview,
    rating: match.content.rating,
    cast: match.cast,
    characters: match.characters,
    similarity: match.similarity,
  }));
  const fallbackAnswer = buildGroundedFallbackAnswer(candidates);
  const taskType = classifyAITask(message);

  if (!candidates.length) {
    return Response.json({
      answer: fallbackAnswer,
      intent,
      recommendations: [],
      meta: {
        provider: "deterministic-fallback",
        model: null,
        taskType,
        usedFallbackModel: false,
        errorType: "insufficient_context",
        retrievalEngine: retrieval.engine,
        retrievalFallbackUsed: retrieval.fallbackUsed,
        retrievalFallbackReason: retrieval.fallbackReason,
        groundedSources: 0,
      },
    });
  }

  const userContext = await loadUserHistoryContext(request).catch(() => undefined);
  const ai = await requestAIChat({
    config: createAIConfig(),
    taskType,
    messages: buildRecommendationMessages(message, candidates, userContext),
  });

  return Response.json({
    answer: ai.answer ?? fallbackAnswer,
    intent,
    recommendations: recommendations.map((match) => ({
      id: match.content.id,
      title: match.content.title,
      poster: match.content.posterUrl,
      type: match.content.type,
      score: Number(match.score.toFixed(4)),
      reason: match.reason,
    })),
    meta: {
      provider: ai.provider,
      model: ai.model,
      taskType: ai.taskType,
      usedFallbackModel: ai.usedFallbackModel,
      errorType: ai.errorType,
      retrievalEngine: retrieval.engine,
      retrievalFallbackUsed: retrieval.fallbackUsed,
      retrievalFallbackReason: retrieval.fallbackReason,
      groundedSources: recommendations.length,
    },
  });
}
