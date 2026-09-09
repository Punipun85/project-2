import type { ContentType, EntertainmentContent } from "./content-types";

export type PreferenceProfile = {
  favoriteContentTypes: ContentType[];
  preferredLanguages: string[];
  favoriteGenres: string[];
  favoriteCountries: string[];
  themes: string[];
};

export type RecommendationResult = {
  content: EntertainmentContent;
  contentScore: number;
  collaborativeScore: number;
  finalScore: number;
  reason: string;
};

export type SearchIntent = {
  contentTypes: ContentType[];
  languages: string[];
  themes: string[];
  terms: string[];
};

const typeKeywords: Record<ContentType, string[]> = {
  movie: ["movie", "film", "cinema", "nolan"],
  anime: ["anime", "manga", "shonen", "studio"],
  kdrama: ["k-drama", "kdrama", "korean drama", "romance drama"],
  series: ["series", "tv show", "show", "episode"],
  documentary: ["documentary", "true story", "nature", "real life"],
};

const themeKeywords: Record<string, string[]> = {
  "Genius protagonist": ["genius", "smart main character", "mastermind", "strategic"],
  Romance: ["romance", "romantic", "love story"],
  Emotional: ["emotional", "cry", "sad", "bittersweet", "heartbreaking"],
  Psychological: ["psychological", "mind game", "dark"],
  War: ["war", "battle", "military"],
  "Coming of age": ["coming of age", "youth", "teen"],
  Mystery: ["mystery", "twist", "secret"],
};

const stopwords = new Set([
  "a",
  "an",
  "and",
  "for",
  "i",
  "in",
  "is",
  "like",
  "me",
  "movie",
  "of",
  "show",
  "something",
  "that",
  "the",
  "to",
  "want",
  "with",
]);

const normalize = (value: string) => value.toLowerCase().trim();

function overlapScore(source: string[], target: string[]): number {
  if (!source.length) return 0.5;
  const targetSet = new Set(target.map(normalize));
  return source.filter((value) => targetSet.has(normalize(value))).length / source.length;
}

export function detectIntent(message: string): SearchIntent {
  const normalized = normalize(message);
  const contentTypes = (Object.entries(typeKeywords) as [ContentType, string[]][])
    .filter(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)))
    .map(([type]) => type);

  const languages = [
    ["Japanese", ["japanese", "japan"]],
    ["Korean", ["korean", "korea", "k-drama", "kdrama"]],
    ["Chinese", ["chinese", "china", "cdrama"]],
    ["English", ["english", "hollywood"]],
  ]
    .filter(([, keywords]) => (keywords as string[]).some((keyword) => normalized.includes(keyword)))
    .map(([language]) => language as string);

  const themes = Object.entries(themeKeywords)
    .filter(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)))
    .map(([theme]) => theme);

  const terms = normalized
    .replace(/[^a-z0-9\- ]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !stopwords.has(term));

  return { contentTypes, languages, themes, terms };
}

export function semanticSearch(
  items: EntertainmentContent[],
  query: string,
  limit = 8,
): RecommendationResult[] {
  const intent = detectIntent(query);
  const normalizedQuery = normalize(query);

  return items
    .map((content) => {
      const searchable = [
        content.title,
        content.originalTitle ?? "",
        content.description,
        content.director ?? "",
        content.studio ?? "",
        ...content.genres,
        ...content.themes,
        ...content.cast,
      ]
        .join(" ")
        .toLowerCase();
      const termHits = intent.terms.filter((term) => searchable.includes(term)).length;
      const titleBoost = normalizedQuery.includes(normalize(content.title)) ? 1 : 0;
      const typeBoost = intent.contentTypes.includes(content.type) ? 1 : 0;
      const languageBoost = intent.languages.includes(content.language) ? 1 : 0;
      const themeBoost = intent.themes.some((theme) =>
        searchable.includes(normalize(theme)),
      )
        ? 1
        : 0;
      const contentScore = Math.min(
        1,
        titleBoost * 0.42 +
          typeBoost * 0.2 +
          languageBoost * 0.12 +
          themeBoost * 0.18 +
          Math.min(termHits / Math.max(intent.terms.length, 1), 1) * 0.35,
      );
      const collaborativeScore =
        (content.rating / 10) * 0.6 + (content.popularity / 100) * 0.4;
      const finalScore = contentScore * 0.6 + collaborativeScore * 0.4;

      return {
        content,
        contentScore,
        collaborativeScore,
        finalScore,
        reason: buildSearchReason(content, intent),
      };
    })
    .filter((result) => result.contentScore > 0 || !intent.terms.length)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
}

export function rankForUser(
  items: EntertainmentContent[],
  profile: PreferenceProfile,
  limit = 12,
): RecommendationResult[] {
  return items
    .map((content) => {
      const typeScore = profile.favoriteContentTypes.includes(content.type) ? 1 : 0.25;
      const genreScore = overlapScore(profile.favoriteGenres, content.genres);
      const languageScore = profile.preferredLanguages.includes(content.language) ? 1 : 0.2;
      const countryScore = profile.favoriteCountries.includes(content.country) ? 1 : 0.35;
      const themeScore = overlapScore(profile.themes, content.themes);
      const contentScore =
        typeScore * 0.2 +
        genreScore * 0.28 +
        languageScore * 0.16 +
        countryScore * 0.1 +
        themeScore * 0.26;
      const collaborativeScore =
        (content.rating / 10) * 0.65 + (content.popularity / 100) * 0.35;
      const finalScore = contentScore * 0.6 + collaborativeScore * 0.4;

      return {
        content,
        contentScore,
        collaborativeScore,
        finalScore,
        reason: content.reason,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
}

function buildSearchReason(content: EntertainmentContent, intent: SearchIntent): string {
  const matchingTheme = intent.themes.find((theme) =>
    [...content.themes, ...content.genres].some((value) =>
      normalize(value).includes(normalize(theme)),
    ),
  );

  if (matchingTheme) {
    return `${content.title} matches the ${matchingTheme.toLowerCase()} tone in your request and your preference for ${content.genres[0].toLowerCase()}.`;
  }
  if (intent.contentTypes.includes(content.type)) {
    return `${content.title} is a strong ${content.type} match with high audience affinity and themes close to your query.`;
  }
  return content.reason;
}

export const defaultProfile: PreferenceProfile = {
  favoriteContentTypes: ["movie", "anime", "kdrama", "series"],
  preferredLanguages: ["English", "Japanese", "Korean"],
  favoriteGenres: ["Sci-Fi", "Drama", "Romance", "Action"],
  favoriteCountries: ["United States", "Japan", "South Korea"],
  themes: ["Moral ambiguity", "Family", "Coming of age", "First love"],
};
