import { readRuntimeEnv } from "@/lib/runtime-env";

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
  const url = environment.SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const anonKey = environment.SUPABASE_ANON_KEY?.trim() ?? "";
  return Object.freeze({
    url,
    anonKey,
    isConfigured: Boolean(url && anonKey),
  });
}
