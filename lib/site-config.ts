import { readRuntimeEnv } from "@/lib/runtime-env";

const DEFAULT_SITE_URL = "https://entertainment-ai.virgow.chatgpt.site";

export function getSiteUrl(): string {
  const environment = readRuntimeEnv();
  const value =
    environment.NEXT_PUBLIC_SITE_URL?.trim() ||
    environment.SITE_URL?.trim() ||
    environment.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    environment.VERCEL_URL?.trim() ||
    DEFAULT_SITE_URL;

  if (/^https?:\/\//i.test(value)) {
    return value.replace(/\/$/, "");
  }

  return `https://${value.replace(/\/$/, "")}`;
}
