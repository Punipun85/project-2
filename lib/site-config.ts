import { requireEnvironmentValue } from "@/lib/env";

export function getSiteUrl(): string {
  const value = requireEnvironmentValue("NEXT_PUBLIC_SITE_URL");

  if (/^https?:\/\//i.test(value)) {
    return value.replace(/\/$/, "");
  }

  return `https://${value.replace(/\/$/, "")}`;
}
