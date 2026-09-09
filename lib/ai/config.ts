import {
  getEnvironmentValue,
  readRuntimeEnv,
  type RuntimeEnvironment,
  validateProductionServiceUrls,
} from "@/lib/env";

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

function processEnvironment(): AIEnvironment {
  return readRuntimeEnv() as AIEnvironment;
}

export function createAIConfig(
  environment: AIEnvironment = processEnvironment(),
): AIConfig {
  const runtimeEnvironment = environment as RuntimeEnvironment;
  const config = {
    baseUrl: getEnvironmentValue("REMOTE_AI_BASE_URL", runtimeEnvironment).replace(/\/$/, ""),
    apiKey: getEnvironmentValue("REMOTE_AI_API_KEY", runtimeEnvironment),
    defaultModel: getEnvironmentValue("REMOTE_AI_DEFAULT_MODEL", runtimeEnvironment),
    reasoningModel: getEnvironmentValue("REMOTE_AI_REASONING_MODEL", runtimeEnvironment),
    fallbackModel: getEnvironmentValue("REMOTE_AI_FALLBACK_MODEL", runtimeEnvironment),
  };
  const validationErrors: string[] = [];

  if (!config.baseUrl) validationErrors.push("Missing required environment variable: REMOTE_AI_BASE_URL");
  if (config.baseUrl) {
    try {
      const url = new URL(config.baseUrl);
      if (!/^https?:$/.test(url.protocol)) validationErrors.push("REMOTE_AI_BASE_URL must be a valid HTTP(S) URL");
    } catch {
      validationErrors.push("REMOTE_AI_BASE_URL must be a valid URL");
    }
  }
  if (!config.apiKey) validationErrors.push("Missing required environment variable: REMOTE_AI_API_KEY");
  if (!config.defaultModel) validationErrors.push("Missing required environment variable: REMOTE_AI_DEFAULT_MODEL");
  if (!config.reasoningModel) validationErrors.push("Missing required environment variable: REMOTE_AI_REASONING_MODEL");
  if (!config.fallbackModel) validationErrors.push("Missing required environment variable: REMOTE_AI_FALLBACK_MODEL");
  validationErrors.push(...validateProductionServiceUrls(["REMOTE_AI_BASE_URL"], runtimeEnvironment));

  return Object.freeze({
    ...config,
    validationErrors,
    isConfigured: validationErrors.length === 0,
  });
}

export const aiConfig = createAIConfig();
