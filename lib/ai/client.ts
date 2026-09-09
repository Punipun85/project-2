import { AIServiceError, requestAIServiceJSON } from "@/lib/ai-client";
import type { AIConfig } from "./config";
import { logAIRequest } from "./logger";
import { selectAIModel, type AITaskType } from "./router";

export type AIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AICandidate = {
  title: string;
  type: string;
  genres: string[];
  themes: string[];
  reason: string;
  overview?: string;
  rating?: number;
  cast?: string[];
  characters?: string[];
  similarity?: number;
};

type OpenAICompatibleResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function isCompletionResponse(payload: unknown): payload is OpenAICompatibleResponse {
  if (!payload || typeof payload !== "object") return false;
  const answer = (payload as OpenAICompatibleResponse).choices?.[0]?.message?.content;
  return typeof answer === "string" && Boolean(answer.trim());
}

export type AIClientResult = {
  answer: string | null;
  provider: "openai-compatible" | "deterministic-fallback";
  model: string;
  taskType: AITaskType;
  usedFallbackModel: boolean;
  errorType: string | null;
};

export class AIRequestError extends Error {
  constructor(
    public readonly errorType: string,
    public readonly retryable: boolean,
  ) {
    super(errorType);
    this.name = "AIRequestError";
  }
}

export function buildRecommendationMessages(
  message: string,
  candidates: AICandidate[],
  userContext?: string,
): AIChatMessage[] {
  const candidateContext = candidates.map((candidate) => ({
    title: candidate.title,
    type: candidate.type,
    genres: candidate.genres,
    themes: candidate.themes,
    recommendationReason: candidate.reason,
    overview: candidate.overview,
    rating: candidate.rating,
    cast: candidate.cast,
    characters: candidate.characters,
    semanticSimilarity: candidate.similarity,
  }));

  return [
    {
      role: "system",
      content:
        "You are Lumi, NexaPlay AI's concise entertainment curator. Answer in the user's language. Use only the supplied NexaPlay catalog context and optional user-history summary. Never invent titles, plot details, characters, cast, ratings, or availability. Explain why each recommendation matches and explicitly name the metadata or user preference that supports it. If the catalog context is empty or insufficient, clearly say that the information is unavailable in NexaPlay; do not substitute general knowledge. Keep the answer to at most three short paragraphs.",
    },
    {
      role: "user",
      content: `User request: ${message}\n\nRetrieved catalog context:\n${JSON.stringify(candidateContext)}${userContext ? `\n\nUser history summary:\n${userContext}` : ""}`,
    },
  ];
}

export function buildGroundedFallbackAnswer(candidates: AICandidate[]): string {
  if (!candidates.length) {
    return "I don't have enough verified NexaPlay catalog information to answer that yet. Try another title or add a genre, mood, or content type.";
  }
  return `I found ${candidates.map((candidate) => candidate.title).join(", ")}. ${candidates[0].reason}`;
}

export async function executeWithFallback<T>(
  taskType: Exclude<AITaskType, "fallback">,
  config: AIConfig,
  operation: (model: string, routedTask: AITaskType) => Promise<T>,
): Promise<{
  value: T;
  model: string;
  taskType: AITaskType;
  usedFallbackModel: boolean;
}> {
  const primaryModel = selectAIModel(taskType, config);
  try {
    return {
      value: await operation(primaryModel, taskType),
      model: primaryModel,
      taskType,
      usedFallbackModel: false,
    };
  } catch (error) {
    if (!(error instanceof AIRequestError) || !error.retryable) throw error;
    const fallbackModel = selectAIModel("fallback", config);
    return {
      value: await operation(fallbackModel, "fallback"),
      model: fallbackModel,
      taskType: "fallback",
      usedFallbackModel: true,
    };
  }
}

async function requestCompletion(
  config: AIConfig,
  model: string,
  taskType: AITaskType,
  messages: AIChatMessage[],
  fetchImplementation: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  let errorType: string | null = null;

  try {
    const payload = await requestAIServiceJSON<OpenAICompatibleResponse>({
      service: "llm",
      url: `${config.baseUrl}/chat/completions`,
      timeoutMs,
      fetchImplementation,
      init: {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: taskType === "reasoning" ? 0.35 : 0.55,
          max_tokens: taskType === "reasoning" ? 700 : 300,
        }),
      },
      validate: isCompletionResponse,
    });
    const answer = payload.choices![0].message!.content!;

    logAIRequest({
      model,
      taskType,
      durationMs: Date.now() - startedAt,
      success: true,
      errorType: null,
    });
    return answer.trim();
  } catch (error) {
    const failure = error instanceof AIServiceError
      ? new AIRequestError(
          error.code === "http_error"
            ? (error.status !== null && error.status >= 500
                ? "http_server_error"
                : "http_client_error")
            : error.code,
          error.code !== "http_error" || error.status === null || error.status >= 500,
        )
      : error instanceof AIRequestError
        ? error
        : new AIRequestError("unknown_error", true);
    errorType = failure.errorType;
    logAIRequest({
      model,
      taskType,
      durationMs: Date.now() - startedAt,
      success: false,
      errorType,
    });
    throw failure;
  }
}

export async function requestAIChat({
  config,
  taskType,
  messages,
  fetchImplementation = fetch,
  timeoutMs = 35_000,
}: {
  config: AIConfig;
  taskType: Exclude<AITaskType, "fallback">;
  messages: AIChatMessage[];
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}): Promise<AIClientResult> {
  const selectedModel = selectAIModel(taskType, config);
  if (!config.isConfigured) {
    logAIRequest({
      model: selectedModel,
      taskType,
      durationMs: 0,
      success: false,
      errorType: config.validationErrors[0] ?? "invalid_configuration",
    });
    return {
      answer: null,
      provider: "deterministic-fallback",
      model: selectedModel,
      taskType,
      usedFallbackModel: false,
      errorType: config.validationErrors[0] ?? "invalid_configuration",
    };
  }

  try {
    const result = await executeWithFallback(
      taskType,
      config,
      (model, routedTask) =>
        requestCompletion(
          config,
          model,
          routedTask,
          messages,
          fetchImplementation,
          timeoutMs,
        ),
    );
    return {
      answer: result.value,
      provider: "openai-compatible",
      model: result.model,
      taskType: result.taskType,
      usedFallbackModel: result.usedFallbackModel,
      errorType: null,
    };
  } catch (error) {
    const failure =
      error instanceof AIRequestError
        ? error
        : new AIRequestError("unknown_error", false);
    return {
      answer: null,
      provider: "deterministic-fallback",
      model: failure.retryable
        ? selectAIModel("fallback", config)
        : selectedModel,
      taskType: failure.retryable ? "fallback" : taskType,
      usedFallbackModel: failure.retryable,
      errorType: failure.errorType,
    };
  }
}
