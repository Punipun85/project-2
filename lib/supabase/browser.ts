"use client";

import { createBrowserClient } from "@supabase/ssr";

export type PublicSupabaseConfig = Readonly<{
  url: string;
  anonKey: string;
  isConfigured: boolean;
}>;

export function createSupabaseBrowserClient(config: PublicSupabaseConfig) {
  if (!config.isConfigured) {
    throw new Error("Supabase Auth is not configured.");
  }

  return createBrowserClient(config.url, config.anonKey);
}
