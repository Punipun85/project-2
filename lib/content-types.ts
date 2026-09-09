export const contentTypes = [
  "movie",
  "anime",
  "kdrama",
  "series",
  "documentary",
] as const;

export type ContentType = (typeof contentTypes)[number];

export type ContentProvider = "tmdb" | "mal" | "jikan" | "internal";

export type EntertainmentContent = {
  id: string;
  externalId: string;
  provider: ContentProvider;
  type: ContentType;
  title: string;
  originalTitle?: string;
  description: string;
  posterUrl: string;
  backdropUrl: string;
  genres: string[];
  themes: string[];
  language: string;
  country: string;
  releaseYear: number;
  duration?: number;
  episodes?: number;
  season?: string;
  studio?: string;
  sourceMaterial?: string;
  director?: string;
  cast: string[];
  rating: number;
  popularity: number;
  match: number;
  reason: string;
  progress?: number;
  trailerUrl?: string;
};

export const contentTypeLabels: Record<ContentType, string> = {
  movie: "Movie",
  anime: "Anime",
  kdrama: "K-Drama",
  series: "TV Series",
  documentary: "Documentary",
};
