import type { EntertainmentContent } from "@/lib/content-types";
import { getAppEnvironment } from "@/lib/env";
import { getContentById } from "@/lib/content-service";
import { resolveProviderTrailer } from "@/lib/provider-trailers";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, restFetch } from "@/lib/supabase/server";

export type Credit = {
  name: string;
  role?: string;
  character?: string;
};

export type CharacterCredit = {
  id?: number;
  name: string;
  role: string;
  description?: string;
  imageUrl?: string;
  actorName?: string;
  voiceActor?: string;
};

export type ContentUserState = {
  authenticated: boolean;
  watchlisted: boolean;
  favorite: boolean;
  rating: number | null;
  notInterested: boolean;
};

export type ContentExperience = EntertainmentContent & {
  tagline?: string;
  trailerUrl?: string;
  network?: string;
  platform?: string;
  status?: string;
  studios: string[];
  creators: Credit[];
  writers: Credit[];
  castCredits: Credit[];
  characters: CharacterCredit[];
  userState: ContentUserState;
};

type JsonRecord = Record<string, unknown>;

const CURATED_CHARACTER_FALLBACKS: Record<string, CharacterCredit[]> = {
  "16498": [
    { name: "Eren Yeager", role: "main", voiceActor: "Yuki Kaji" },
    { name: "Mikasa Ackerman", role: "main", voiceActor: "Yui Ishikawa" },
    { name: "Armin Arlert", role: "main", voiceActor: "Marina Inoue" },
  ],
};

export function jsonLabels(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      return jsonLabels(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as JsonRecord).name === "string") {
      return [String((item as JsonRecord).name)];
    }
    return [];
  });
}

function credits(value: unknown): Credit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ name: item }];
    if (!item || typeof item !== "object") return [];
    const row = item as JsonRecord;
    const name = String(row.name ?? "").trim();
    if (!name) return [];
    return [{
      name,
      role: String(row.role ?? row.job ?? "").trim() || undefined,
      character: String(row.character ?? "").trim() || undefined,
    }];
  });
}

function fallbackCharacters(value: unknown): CharacterCredit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === "string") return [{ name: item, role: "supporting" }];
    if (!item || typeof item !== "object") return [];
    const row = item as JsonRecord;
    const name = String(row.name ?? row.character ?? "").trim();
    if (!name) return [];
    return [{
      id: index,
      name,
      role: String(row.role ?? "supporting").toLowerCase(),
      description: String(row.description ?? "").trim() || undefined,
      imageUrl: String(row.image_url ?? row.image ?? "").trim() || undefined,
      actorName: String(row.actor_name ?? row.performer ?? "").trim() || undefined,
      voiceActor: String(row.voice_actor ?? "").trim() || undefined,
    }];
  });
}

function relationCharacters(rows: JsonRecord[]): CharacterCredit[] {
  return rows.flatMap((row) => {
    const nested = Array.isArray(row.characters) ? row.characters[0] : row.characters;
    if (!nested || typeof nested !== "object") return [];
    const character = nested as JsonRecord;
    const name = String(character.name ?? "").trim();
    if (!name) return [];
    return [{
      id: Number(character.id) || undefined,
      name,
      role: String(row.role ?? "supporting"),
      description: String(character.description ?? "").trim() || undefined,
      imageUrl: String(character.image_url ?? "").trim() || undefined,
      actorName: String(row.actor_name ?? "").trim() || undefined,
      voiceActor: String(row.voice_actor ?? "").trim() || undefined,
    }];
  });
}

async function responseRows(response: Response): Promise<JsonRecord[]> {
  if (!response.ok) return [];
  const payload = await response.json().catch(() => []);
  return Array.isArray(payload) ? payload as JsonRecord[] : [];
}

export async function getContentExperience(
  request: Request,
  id: string,
  options: { resolveTrailer?: boolean } = {},
): Promise<ContentExperience | null> {
  const base = await getContentById(id);
  if (!base) return null;
  const config = createSupabaseConfig();
  const numericId = Number(base.id);
  const session = config.isConfigured ? await requireSupabaseUser(request, config) : null;
  const emptyState: ContentUserState = {
    authenticated: Boolean(session),
    watchlisted: false,
    favorite: false,
    rating: null,
    notInterested: false,
  };

  if (!config.isConfigured || !Number.isInteger(numericId)) {
    const trailerUrl = options.resolveTrailer === false ? base.trailerUrl ?? null : await resolveProviderTrailer(base);
    return {
      ...base,
      trailerUrl: trailerUrl ?? undefined,
      studios: base.studio ? [base.studio] : [],
      creators: base.director ? [{ name: base.director, role: "Director" }] : [],
      writers: [],
      castCredits: base.cast.map((name) => ({ name })),
      characters: getAppEnvironment() === "production"
        ? []
        : CURATED_CHARACTER_FALLBACKS[base.externalId] ?? [],
      userState: emptyState,
    };
  }

  const token = session?.token ?? config.anonKey;
  const detailQuery = new URLSearchParams({
    select: "tagline,trailer_url,network,platform,status,studio,creator,director,cast,characters,episode_duration_minutes",
    id: `eq.${numericId}`,
    limit: "1",
  });
  const characterQuery = new URLSearchParams({
    select: "role,actor_name,voice_actor,importance_score,characters(id,name,description,image_url)",
    content_id: `eq.${numericId}`,
    order: "importance_score.desc",
    limit: "20",
  });
  const requests: Promise<Response>[] = [
    restFetch(config, token, `contents?${detailQuery}`),
    restFetch(config, token, `content_characters?${characterQuery}`),
  ];
  if (session) {
    requests.push(
      restFetch(config, token, `watchlists?select=id&user_id=eq.${session.user.id}&content_id=eq.${numericId}&limit=1`),
      restFetch(config, token, `favorites?select=id&user_id=eq.${session.user.id}&content_id=eq.${numericId}&limit=1`),
      restFetch(config, token, `ratings?select=rating&user_id=eq.${session.user.id}&content_id=eq.${numericId}&limit=1`),
      restFetch(config, token, `user_interactions?select=id&user_id=eq.${session.user.id}&content_id=eq.${numericId}&interaction_type=eq.not_interested&order=created_at.desc&limit=1`),
    );
  }
  const results = await Promise.all(requests);
  const [details, characterRows, watchlistRows = [], favoriteRows = [], ratingRows = [], negativeRows = []] = await Promise.all(results.map(responseRows));
  const detail = details[0] ?? {};
  const creators = credits(detail.creator);
  const directors = credits(detail.director).map((person) => ({ ...person, role: person.role ?? "Director" }));
  const writers = creators.filter((person) => /writer|screenplay|author/i.test(person.role ?? ""));
  const normalizedCharacters = relationCharacters(characterRows);
  const storedTrailer = String(detail.trailer_url ?? base.trailerUrl ?? "").trim();
  const trailerUrl = storedTrailer || (options.resolveTrailer === false ? undefined : await resolveProviderTrailer(base)) || undefined;

  return {
    ...base,
    duration: (base.duration ?? Number(detail.episode_duration_minutes)) || undefined,
    tagline: String(detail.tagline ?? "").trim() || undefined,
    trailerUrl,
    network: String(detail.network ?? "").trim() || undefined,
    platform: String(detail.platform ?? "").trim() || undefined,
    status: String(detail.status ?? "").trim() || undefined,
    studios: jsonLabels(detail.studio),
    creators: [...directors, ...creators.filter((person) => person.role !== "Director")],
    writers,
    castCredits: credits(detail.cast),
    characters: normalizedCharacters.length ? normalizedCharacters : fallbackCharacters(detail.characters),
    userState: {
      authenticated: Boolean(session),
      watchlisted: watchlistRows.length > 0,
      favorite: favoriteRows.length > 0,
      rating: ratingRows[0] ? Number(ratingRows[0].rating) : null,
      notInterested: negativeRows.length > 0,
    },
  };
}

export function buildDeterministicExplanation(
  content: Pick<ContentExperience, "title" | "genres" | "themes" | "type" | "rating">,
  tasteGenres: string[],
  styles: string[],
  positiveTitles: string[],
): string {
  const taste = new Set(tasteGenres.map((item) => item.toLowerCase()));
  const matches = content.genres.filter((genre) => taste.has(genre.toLowerCase())).slice(0, 3);
  const styleMatches = content.themes.filter((theme) => styles.some((style) => style.toLowerCase() === theme.toLowerCase())).slice(0, 2);
  if (matches.length || styleMatches.length) {
    const signals = [...matches, ...styleMatches].join(", ");
    const history = positiveTitles[0] ? ` Your strong response to ${positiveTitles.slice(0, 2).join(" and ")} reinforces the match.` : "";
    return `${content.title} fits your preference for ${signals} stories.${history}`;
  }
  return `${content.title} is a strong ${content.type.replace("_", " ")} candidate with a ${content.rating.toFixed(1)} audience score and themes that can broaden your current taste profile.`;
}
