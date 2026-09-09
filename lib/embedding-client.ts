import { AIServiceError, requestAIServiceJSON } from "@/lib/ai-client";
import {
  getEnvironmentValue,
  readRuntimeEnv,
  type RuntimeEnvironment,
  validateProductionServiceUrls,
} from "@/lib/env";

export const EMBEDDING_DIMENSIONS = 384;
export const DEFAULT_EMBEDDING_MODEL =
  "sentence-transformers/all-MiniLM-L6-v2";

export type EmbeddingConfig = Readonly<{
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  isConfigured: boolean;
  validationErrors: string[];
}>;

type EmbeddingResponse = {
  embedding: number[];
  model: string;
  dimension: number;
};

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_configured"
      | "timeout"
      | "http_error"
      | "invalid_response"
      | "network_error",
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export function createEmbeddingConfig(
  environment: RuntimeEnvironment = readRuntimeEnv(),
): EmbeddingConfig {
  const apiUrl = getEnvironmentValue("EMBEDDING_API_URL", environment).replace(/\/$/, "");
  const configuredTimeout = Number(getEnvironmentValue("EMBEDDING_TIMEOUT_SECONDS", environment) || 30) * 1_000;
  const apiKey = getEnvironmentValue("EMBEDDING_API_KEY", environment);
  const model = getEnvironmentValue("EMBEDDING_MODEL", environment);
  const validationErrors = [
    ...(!apiUrl ? ["Missing required environment variable: EMBEDDING_API_URL"] : []),
    ...(!apiKey ? ["Missing required environment variable: EMBEDDING_API_KEY"] : []),
    ...(!model ? ["Missing required environment variable: EMBEDDING_MODEL"] : []),
    ...validateProductionServiceUrls(["EMBEDDING_API_URL"], environment),
  ];
  return Object.freeze({
    apiUrl,
    apiKey,
    model,
    timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : 30_000,
    isConfigured: validationErrors.length === 0,
    validationErrors,
  });
}

function isEmbeddingResponse(
  payload: unknown,
  expectedModel: string,
): payload is EmbeddingResponse {
  if (!payload || typeof payload !== "object") return false;
  const response = payload as Partial<EmbeddingResponse>;
  return (
    Array.isArray(response.embedding) &&
    response.embedding.length === EMBEDDING_DIMENSIONS &&
    response.embedding.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) &&
    response.dimension === EMBEDDING_DIMENSIONS &&
    response.model === expectedModel
  );
}

export async function generateEmbedding(
  text: string,
  options: {
    config?: EmbeddingConfig;
    fetchImplementation?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<number[]> {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new EmbeddingError("Text is required", "invalid_response");
  }

  const config = options.config ?? createEmbeddingConfig();
  if (!config.isConfigured) {
    throw new EmbeddingError(
      config.validationErrors[0] ?? "Embedding service is not configured",
      "not_configured",
    );
  }

  try {
    const payload = await requestAIServiceJSON<EmbeddingResponse>({
      service: "embedding",
      url: config.apiUrl,
      timeoutMs: options.timeoutMs ?? config.timeoutMs,
      fetchImplementation: options.fetchImplementation,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ text: normalized }),
      },
      validate: (value): value is EmbeddingResponse =>
        isEmbeddingResponse(value, config.model),
    });
    return payload.embedding;
  } catch (error) {
    if (error instanceof AIServiceError) {
      throw new EmbeddingError(error.message, error.code);
    }
    throw error;
  }
}
