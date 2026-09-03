import { readRuntimeEnv } from "@/lib/runtime-env";

export type AIEnvironment = {
  REMOTE_AI_BASE_URL?: string;
  REMOTE_AI_API_KEY?: string;
  REMOTE_AI_DEFAULT_MODEL?: string;
  REMOTE_AI_REASONING_MODEL?: string;
  REMOTE_AI_FALLBACK_MODEL?: string;
};

export type AIConfig = Readonly<{
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  reasoningModel: string;
  fallbackModel: string;
  validationErrors: string[];
  isConfigured: boolean;
}>;

const DEFAULT_BASE_URL = "https://ai.punipuni.my.id/v1";
const DEFAULT_MODEL = "ag/gemini-3.7-flash-high";
const REASONING_MODEL = "cx/gpt-5.6-sol";
const FALLBACK_MODEL = "cx/gpt-5.6-terra";

function processEnvironment(): AIEnvironment {
  return readRuntimeEnv() as AIEnvironment;
}

function clean(value: string | undefined, fallback = ""): string {
  return value?.trim() || fallback;
}

export function createAIConfig(
  environment: AIEnvironment = processEnvironment(),
): AIConfig {
  const config = {
    baseUrl: clean(environment.REMOTE_AI_BASE_URL, DEFAULT_BASE_URL).replace(
      /\/$/,
      "",
    ),
    apiKey: clean(environment.REMOTE_AI_API_KEY),
    defaultModel: clean(environment.REMOTE_AI_DEFAULT_MODEL, DEFAULT_MODEL),
    reasoningModel: clean(
      environment.REMOTE_AI_REASONING_MODEL,
      REASONING_MODEL,
    ),
    fallbackModel: clean(
      environment.REMOTE_AI_FALLBACK_MODEL,
      FALLBACK_MODEL,
    ),
  };
  const validationErrors: string[] = [];

  try {
    const url = new URL(config.baseUrl);
    if (!/^https?:$/.test(url.protocol)) validationErrors.push("invalid_base_url");
  } catch {
    validationErrors.push("invalid_base_url");
  }
  if (!config.apiKey) validationErrors.push("missing_api_key");
  if (!config.defaultModel) validationErrors.push("missing_default_model");
  if (!config.reasoningModel) validationErrors.push("missing_reasoning_model");
  if (!config.fallbackModel) validationErrors.push("missing_fallback_model");

  return Object.freeze({
    ...config,
    validationErrors,
    isConfigured: validationErrors.length === 0,
  });
}

export const aiConfig = createAIConfig();
