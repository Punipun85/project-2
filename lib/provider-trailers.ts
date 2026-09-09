import type { EntertainmentContent } from "@/lib/catalog";
import { getEnvironmentValue } from "@/lib/env";

const cache = new Map<string, { value: string | null; expires: number }>();

function youtubeTrailer(rows: unknown): string | null {
  if (!Array.isArray(rows)) return null;
  const candidates = rows.filter((item): item is Record<string, unknown> => Boolean(
    item && typeof item === "object" && String((item as Record<string, unknown>).site).toLowerCase() === "youtube" && (item as Record<string, unknown>).key,
  ));
  candidates.sort((a, b) => Number(b.type === "Trailer") - Number(a.type === "Trailer") || Number(Boolean(b.official)) - Number(Boolean(a.official)));
  return candidates[0]?.key ? `https://www.youtube.com/watch?v=${encodeURIComponent(String(candidates[0].key))}` : null;
}

export async function resolveProviderTrailer(content: EntertainmentContent): Promise<string | null> {
  if (content.trailerUrl) return content.trailerUrl;
  const key = `${content.provider}:${content.externalId}:${content.type}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  let value: string | null = null;
  try {
    if (content.provider === "tmdb") {
      const apiKey = getEnvironmentValue("TMDB_API_KEY");
      if (apiKey) {
        const namespace = content.type === "movie" || content.type === "documentary" ? "movie" : "tv";
        const response = await fetch(`https://api.themoviedb.org/3/${namespace}/${encodeURIComponent(content.externalId)}/videos?api_key=${encodeURIComponent(apiKey)}&language=en-US`, { signal: controller.signal });
        if (response.ok) value = youtubeTrailer(((await response.json()) as { results?: unknown }).results);
      }
    } else if (content.provider === "mal" || content.provider === "jikan") {
      const response = await fetch(`https://api.jikan.moe/v4/anime/${encodeURIComponent(content.externalId)}/full`, { signal: controller.signal });
      if (response.ok) {
        const payload = (await response.json()) as { data?: { trailer?: { url?: string | null; youtube_id?: string | null } } };
        value = payload.data?.trailer?.url
          ?? (payload.data?.trailer?.youtube_id ? `https://www.youtube.com/watch?v=${payload.data.trailer.youtube_id}` : null);
      }
    }
  } catch {
    value = null;
  } finally {
    clearTimeout(timeout);
  }
  cache.set(key, { value, expires: Date.now() + 6 * 60 * 60 * 1000 });
  return value;
}
