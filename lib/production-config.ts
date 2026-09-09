import {
  APPLICATION_ENVIRONMENT_NAMES,
  readRuntimeEnv,
  type RuntimeEnvironment,
  validateEnvironment,
  validateProductionServiceUrls,
} from "@/lib/env";

export function validateProductionEnvironment(environment: RuntimeEnvironment = readRuntimeEnv()) {
  const required = validateEnvironment(APPLICATION_ENVIRONMENT_NAMES, environment);
  const urlErrors = validateProductionServiceUrls([
    "NEXT_PUBLIC_SITE_URL",
    "SUPABASE_URL",
    "EMBEDDING_API_URL",
    "REMOTE_AI_BASE_URL",
    "RECOMMENDATION_API_URL",
  ], environment);
  return {
    valid: required.valid && urlErrors.length === 0,
    missing: required.missing,
    errors: [...required.errors, ...urlErrors],
  };
}
