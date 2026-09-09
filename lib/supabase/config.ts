import { getEnvironmentValue, readRuntimeEnv } from "@/lib/env";

export type SupabaseEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

export type SupabaseConfig = Readonly<{
  url: string;
  anonKey: string;
  isConfigured: boolean;
}>;

export function createSupabaseConfig(
  environment: SupabaseEnvironment = readRuntimeEnv() as SupabaseEnvironment,
): SupabaseConfig {
  const url = getEnvironmentValue("SUPABASE_URL", environment).replace(/\/$/, "");
  const anonKey = getEnvironmentValue("SUPABASE_ANON_KEY", environment);
  return Object.freeze({
    url,
    anonKey,
    isConfigured: Boolean(url && anonKey),
  });
}
