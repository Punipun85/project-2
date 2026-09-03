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
};

type OpenAICompatibleResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

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
): AIChatMessage[] {
  const candidateContext = candidates.map((candidate) => ({
    title: candidate.title,
    type: candidate.type,
    genres: candidate.genres,
    themes: candidate.themes,
    recommendationReason: candidate.reason,
  }));

  return [
    {
      role: "system",
      content:
        "You are Lumi, NexaPlay AI's concise entertainment curator. Answer in the user's language. Use only the supplied candidates and metadata. Never invent titles, cast, ratings, or availability. Give clear recommendation reasons in at most two short paragraphs.",
    },
    {
      role: "user",
      content: `User request: ${message}\n\nRanked candidates:\n${JSON.stringify(candidateContext)}`,
    },
  ];
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let errorType: string | null = null;

  try {
    const response = await fetchImplementation(
      `${config.baseUrl}/chat/completions`,
      {
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
        signal: controller.signal,
      },
    );
    if (response.status >= 500) {
      throw new AIRequestError("http_server_error", true);
    }
    if (!response.ok) {
      throw new AIRequestError("http_client_error", false);
    }

    let payload: OpenAICompatibleResponse;
    try {
      payload = (await response.json()) as OpenAICompatibleResponse;
    } catch {
      throw new AIRequestError("invalid_response", true);
    }
    const answer = payload.choices?.[0]?.message?.content;
    if (typeof answer !== "string") {
      throw new AIRequestError("invalid_response", true);
    }
    if (!answer.trim()) throw new AIRequestError("empty_response", true);

    logAIRequest({
      model,
      taskType,
      durationMs: Date.now() - startedAt,
      success: true,
      errorType: null,
    });
    return answer.trim();
  } catch (error) {
    if (error instanceof AIRequestError) {
      errorType = error.errorType;
    } else if (controller.signal.aborted) {
      errorType = "timeout";
    } else {
      errorType = "network_error";
    }
    logAIRequest({
      model,
      taskType,
      durationMs: Date.now() - startedAt,
      success: false,
      errorType,
    });
    throw error instanceof AIRequestError
      ? error
      : new AIRequestError(errorType, true);
  } finally {
    clearTimeout(timeout);
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
