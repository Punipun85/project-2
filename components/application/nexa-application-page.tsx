"use client";

import {
  Bookmark,
  Bot,
  Compass,
  History,
  Heart,
  Home,
  Search,
  Sparkles,
  Star,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ContentProvider, ContentType, EntertainmentContent } from "@/lib/content-types";
import { AIChatBox } from "./ai-chat-box";
import { Carousel } from "./carousel";
import { ContentCard } from "./content-card";
import { ProfilePreference, type PreferenceValue } from "./profile-preference";
import { RecommendationCard } from "./recommendation-card";
import { FavoritesLibrary, PreferenceCenter, RatingHistory } from "@/components/personalization/personalization-pages";

export type ApplicationPage = "home" | "discover" | "search" | "recommendations" | "ai-chat" | "profile" | "preferences" | "favorites" | "rating-history" | "watchlist" | "history";

const navigation: Array<{ page: ApplicationPage; label: string; icon: typeof Home; href: string }> = [
  { page: "home", label: "Home", icon: Home, href: "/" },
  { page: "discover", label: "Discover", icon: Compass, href: "/discover" },
  { page: "search", label: "AI Search", icon: Search, href: "/search" },
  { page: "recommendations", label: "For You", icon: WandSparkles, href: "/recommendations" },
  { page: "ai-chat", label: "AI Assistant", icon: Bot, href: "/ai-chat" },
  { page: "watchlist", label: "Watchlist", icon: Bookmark, href: "/watchlist" },
  { page: "favorites", label: "Favorites", icon: Heart, href: "/favorites" },
  { page: "history", label: "History", icon: History, href: "/history" },
  { page: "rating-history", label: "Ratings", icon: Star, href: "/rating-history" },
  { page: "profile", label: "Profile", icon: UserRound, href: "/profile" },
];

type User = { id: string; email?: string };
type Profile = {
  username?: string;
  favorite_genres?: string[];
  favorite_types?: string[];
  favorite_moods?: string[];
  onboarding_completed?: boolean;
};

type ApiRecord = Record<string, unknown>;

function record(value: unknown): ApiRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as ApiRecord;
}

function labels(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      return labels(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item.trim()] : [];
    const itemRecord = record(item);
    const label = itemRecord && (itemRecord.name ?? itemRecord.title ?? itemRecord.character);
    return typeof label === "string" && label.trim() ? [label.trim()] : [];
  });
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function contentType(value: unknown, seriesType: unknown): ContentType {
  const normalized = String(value ?? "").toLowerCase();
  if ((normalized === "series" || normalized === "tv_series") && String(seriesType ?? "").toLowerCase() === "kdrama") return "kdrama";
  if (normalized === "anime" || normalized === "kdrama" || normalized === "series" || normalized === "documentary") return normalized;
  if (normalized === "tv_series") return "series";
  return "movie";
}

function contentProvider(value: unknown): ContentProvider {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "mal" || normalized === "jikan" || normalized === "internal") return normalized;
  return "tmdb";
}

function normalizeContent(value: unknown): EntertainmentContent | null {
  const outer = record(value);
  if (!outer) return null;
  const nestedValue = Array.isArray(outer.contents) ? outer.contents[0] : outer.contents;
  const content = record(nestedValue) ?? outer;
  const id = content.id ?? outer.content_id ?? outer.id;
  const title = content.title;
  if ((typeof id !== "string" && typeof id !== "number") || typeof title !== "string" || !title.trim()) return null;

  const type = contentType(content.type ?? content.content_type, content.seriesType ?? content.series_type);
  const genres = labels(content.genres);
  const themes = labels(content.themes);
  const rating = numberValue(content.rating ?? content.rating_average);
  const popularity = numberValue(content.popularity ?? content.popularity_score);
  const rawMatch = numberValue(content.match ?? content.final_score ?? content.score);
  const match = rawMatch > 0 && rawMatch <= 1 ? rawMatch * 100 : rawMatch;
  const source = content.provider ?? content.source;
  const country = labels(content.country)[0] ?? (typeof content.country === "string" ? content.country : "Unknown");

  return {
    id: String(id),
    externalId: String(content.externalId ?? content.external_id ?? id),
    provider: contentProvider(source),
    type,
    title: title.trim(),
    originalTitle: String(content.originalTitle ?? content.original_title ?? "").trim() || undefined,
    description: String(content.description ?? content.overview ?? ""),
    posterUrl: String(content.posterUrl ?? content.poster_url ?? ""),
    backdropUrl: String(content.backdropUrl ?? content.backdrop_url ?? content.posterUrl ?? content.poster_url ?? ""),
    genres,
    themes,
    language: String(content.language ?? content.original_language ?? "Unknown"),
    country,
    releaseYear: numberValue(content.releaseYear ?? content.release_year),
    duration: numberValue(content.duration ?? content.duration_minutes) || undefined,
    episodes: numberValue(content.episodes ?? content.number_of_episodes) || undefined,
    season: String(content.season ?? "").trim() || undefined,
    studio: labels(content.studio)[0],
    director: labels(content.director)[0],
    cast: labels(content.cast),
    rating,
    popularity,
    match: Math.round(Math.max(0, Math.min(100, match || rating * 10))),
    reason: String(content.reason ?? `Explore this ${type.replace("_", " ")} from the NexaPlay catalog.`),
    progress: numberValue(outer.progress ?? content.progress) || undefined,
    trailerUrl: String(content.trailerUrl ?? content.trailer_url ?? "").trim() || undefined,
  };
}

function normalizeContentList(value: unknown): EntertainmentContent[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeContent).filter((item): item is EntertainmentContent => Boolean(item));
}

function contentReference(item: EntertainmentContent): { contentId: number } | { externalId: string; provider: ContentProvider } {
  const contentId = Number(item.id);
  return Number.isInteger(contentId)
    ? { contentId }
    : { externalId: item.externalId, provider: item.provider };
}

export function NexaApplicationPage({ page }: { page: ApplicationPage }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contents, setContents] = useState<EntertainmentContent[]>([]);
  const [recommendations, setRecommendations] = useState<EntertainmentContent[]>([]);
  const [watchlist, setWatchlist] = useState<EntertainmentContent[]>([]);
  const [favorites, setFavorites] = useState<EntertainmentContent[]>([]);
  const [history, setHistory] = useState<EntertainmentContent[]>([]);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"normal" | "ai" | "character">("ai");
  const [searchResults, setSearchResults] = useState<EntertainmentContent[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void (async () => {
      const [session, contentsPayload, recommendationPayload] = await Promise.all([
        fetch("/api/auth/session").then((response) => response.json()).catch(() => ({ user: null })),
        fetch("/api/contents?limit=100").then((response) => response.json()).catch(() => ({ data: [] })),
        fetch("/api/recommendations?limit=12").then((response) => response.json()).catch(() => ({ data: [] })),
      ]);
      setUser(session.user ?? null);
      setContents(normalizeContentList(contentsPayload.data));
      setRecommendations(normalizeContentList(recommendationPayload.data));
      if (!session.user) return;
      const [profilePayload, watchlistPayload, historyPayload, favoritesPayload] = await Promise.all([
        fetch("/api/user/profile").then((response) => response.json()),
        fetch("/api/user/watchlist").then((response) => response.json()),
        fetch("/api/user/history").then((response) => response.json()),
        fetch("/api/user/favorites").then((response) => response.json()),
      ]);
      setProfile(profilePayload.data ?? null);
      setWatchlist(normalizeContentList(watchlistPayload.data));
      setHistory(normalizeContentList(historyPayload.data));
      setFavorites(normalizeContentList(favoritesPayload.data));
    })();
  }, []);

  useEffect(() => {
    if (page !== "search") return;
    const initialQuery = new URLSearchParams(window.location.search).get("q")?.trim();
    if (!initialQuery) return;
    void (async () => {
      const payload = await fetch("/api/search/semantic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: initialQuery, limit: 16 }),
      }).then((response) => response.json()).catch(() => ({ data: [] }));
      setQuery(initialQuery);
      setSearchResults(normalizeContentList(payload.data));
    })();
  }, [page]);

  const savedIds = useMemo(() => new Set(watchlist.map((item) => item.id)), [watchlist]);
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);
  const track = (eventType: string, item?: EntertainmentContent, metadata?: Record<string, unknown>) => {
    if (!user) return;
    void fetch("/api/user/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType, ...(item ? contentReference(item) : {}), metadata }),
    });
  };
  const toggleWatchlist = async (item: EntertainmentContent) => {
    if (!user) { window.location.assign("/auth"); return; }
    const saved = savedIds.has(item.id);
    const response = await fetch("/api/user/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: saved ? "remove" : "add", ...contentReference(item) }),
    });
    if (response.ok) setWatchlist((current) => saved ? current.filter((entry) => entry.id !== item.id) : [item, ...current]);
    track("watchlist", item, { action: saved ? "remove" : "add" });
  };
  const toggleFavorite = async (item: EntertainmentContent) => {
    if (!user) { window.location.assign("/auth"); return; }
    const saved = favoriteIds.has(item.id);
    const response = await fetch("/api/user/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: saved ? "remove" : "add", ...contentReference(item) }),
    });
    if (response.ok) setFavorites((current) => saved ? current.filter((entry) => entry.id !== item.id) : [item, ...current]);
  };
  const openContent = (item: EntertainmentContent, source = "catalog") => {
    track("click", item, { source });
    void fetch("/api/user/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...contentReference(item), progress: Math.max(item.progress ?? 5, 5) }),
    });
    window.location.assign(`/content/${encodeURIComponent(item.id)}`);
  };
  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const payload = searchMode === "normal"
        ? await fetch(`/api/contents?search=${encodeURIComponent(query)}&limit=16`).then((response) => response.json())
        : await fetch("/api/search/semantic", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: searchMode === "character" ? `character ${query}` : query, limit: 16 }),
          }).then((response) => response.json());
      setSearchResults(normalizeContentList(payload.data));
      track("search", undefined, { query, mode: searchMode });
    } finally {
      setSearching(false);
    }
  };

  const cards = (items: EntertainmentContent[], recommended = false, showReason = false) => items.map((item) => recommended ? (
    <RecommendationCard key={item.id} item={item} saved={savedIds.has(item.id)} favorite={favoriteIds.has(item.id)} onOpen={() => openContent(item, "recommendation")} onWatchlist={() => toggleWatchlist(item)} onFavorite={() => toggleFavorite(item)} />
  ) : (
    <ContentCard key={item.id} item={item} saved={savedIds.has(item.id)} favorite={favoriteIds.has(item.id)} showReason={showReason} onOpen={() => openContent(item)} onWatchlist={() => toggleWatchlist(item)} onFavorite={() => toggleFavorite(item)} />
  ));

  return (
    <div className="entertainment-app batch4-app">
      <aside className="sidebar batch4-sidebar">
        <Link className="brand" href="/"><span className="brand-symbol"><Sparkles size={15} /></span><span className="brand-copy">NexaPlay <span>AI</span><small>Intelligent entertainment</small></span></Link>
        <div className="nav-label">Your universe</div>
        <nav className="nav-stack">{navigation.map(({ page: target, label, icon: Icon, href }) => <Link key={target} href={href} className={`nav-button ${page === target ? "active" : ""}`}><Icon size={16} /><span>{label}</span></Link>)}</nav>
        <div className="sidebar-spacer" />
        <div className="taste-card"><span className="taste-top"><WandSparkles size={15} /> TASTE PROFILE</span><strong>{profile?.username || user?.email?.split("@")[0] || "Guest explorer"}</strong><p>{profile?.onboarding_completed ? "Your personal recommendation signals are active." : "Sign in and calibrate your genres, formats, and moods."}</p><Link href={user ? "/profile" : "/auth"}>{user ? "Refine preferences" : "Sign in"}</Link></div>
      </aside>
      <main className="main-shell">
        <header className="topbar batch4-topbar"><Link href="/search" className="universal-search"><Search size={16} /><span>Search movies, anime, series, characters…</span></Link><div className="topbar-tools"><Link className="ask-top" href="/ai-chat"><Sparkles size={14} /> Ask Lumi</Link><Link className="user-avatar" href={user ? "/profile" : "/auth"}>{user?.email?.slice(0, 2).toUpperCase() || "IN"}</Link></div></header>
        <div className="page-wrap batch4-page">
          {page === "home" && <><div className="home-heading"><div><span className="section-kicker">YOUR DAILY AI SIGNAL</span><h1>Your universe, <i>curated.</i></h1><p>Personal recommendations, continuing stories, and intelligent collections in one place.</p></div><Link className="mood-trigger" href="/ai-chat"><Sparkles size={14} /> Set tonight&apos;s mood</Link></div><Carousel eyebrow="HYBRID RECOMMENDATION" title="Recommended for you" href="/recommendations">{cards(recommendations.slice(0, 6), true)}</Carousel>{history.length > 0 && <Carousel eyebrow="PICK UP WHERE YOU LEFT" title="Continue watching" href="/history">{cards(history.slice(0, 6))}</Carousel>}<Carousel eyebrow="WHAT EVERYONE IS WATCHING" title="Trending now" href="/discover">{cards([...contents].sort((a, b) => b.popularity - a.popularity).slice(0, 6))}</Carousel><section className="ai-collections"><div className="section-header"><div><span>SEMANTIC COLLECTIONS</span><h2>Explore an idea</h2></div></div><div>{["Smart characters", "Emotional anime", "Dark sci-fi"].map((collection) => <Link key={collection} href={`/search?q=${encodeURIComponent(collection)}`}><Sparkles size={16} /><strong>{collection}</strong><small>AI-curated collection</small></Link>)}</div></section></>}
          {page === "discover" && <><div className="page-heading"><div><span className="section-kicker">ALL ENTERTAINMENT</span><h1>Discover every universe</h1><p>Movies, anime, K-drama, series, and documentaries in one intelligent catalog.</p></div></div><div className="library-grid">{cards(contents)}</div></>}
          {page === "recommendations" && <><div className="page-heading"><div><span className="section-kicker">PERSONAL AI RANKING</span><h1>Recommended for you</h1><p>Ranked from your profile, activity, content similarity, and popularity.</p></div></div>{!user && <AuthPrompt />}<div className="library-grid">{cards(recommendations, true)}</div></>}
          {page === "search" && <><div className="page-heading"><div><span className="section-kicker">MULTIMODAL DISCOVERY</span><h1>Search by title, meaning, or character</h1><p>Every result includes an AI match percentage and the strongest evidence behind it.</p></div></div><form className="batch4-search" onSubmit={submitSearch}><div className="filter-pills">{(["normal", "ai", "character"] as const).map((mode) => <button type="button" key={mode} className={searchMode === mode ? "selected" : ""} onClick={() => setSearchMode(mode)}>{mode === "ai" ? "AI Semantic" : mode[0].toUpperCase() + mode.slice(1)}</button>)}</div><div><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try: dark anime with smart characters" /><button className="primary-action">{searching ? "Searching…" : "Search"}</button></div></form><div className="library-grid search-results-grid">{cards(searchResults, false, true)}</div></>}
          {page === "ai-chat" && <><div className="page-heading"><div><span className="section-kicker">RAG ENTERTAINMENT ASSISTANT</span><h1>Ask Lumi</h1><p>Natural conversation grounded in the NexaPlay catalog.</p></div></div><AIChatBox /></>}
          {page === "watchlist" && <><div className="page-heading"><div><span className="section-kicker">SAVED FOR LATER</span><h1>Your watchlist</h1><p>Every story you saved across all entertainment types.</p></div></div>{!user ? <AuthPrompt /> : watchlist.length ? <div className="library-grid">{cards(watchlist)}</div> : <EmptyState title="Your watchlist is empty" />}</>}
          {page === "history" && <><div className="page-heading"><div><span className="section-kicker">WATCH ACTIVITY</span><h1>History & continue watching</h1><p>Your viewing progress, synchronized securely to your account.</p></div></div>{!user ? <AuthPrompt /> : history.length ? <div className="library-grid">{cards(history)}</div> : <EmptyState title="No viewing history yet" />}</>}
          {page === "profile" && <><div className="page-heading"><div><span className="section-kicker">PERSONAL PROFILE</span><h1>Your taste dashboard</h1><p>Control the signals used to personalize NexaPlay AI.</p></div>{user && <button className="ghost-action" onClick={() => void fetch("/api/auth/logout", { method: "POST" }).then(() => { window.location.assign("/"); })}>Sign out</button>}</div>{!user ? <AuthPrompt /> : <ProfilePreference initial={{ username: profile?.username, favoriteGenres: profile?.favorite_genres, favoriteTypes: profile?.favorite_types, favoriteMoods: profile?.favorite_moods }} onSaved={(value: PreferenceValue) => setProfile({ username: value.username, favorite_genres: value.favoriteGenres, favorite_types: value.favoriteTypes, favorite_moods: value.favoriteMoods, onboarding_completed: true })} />}</>}
          {page === "preferences" && <><div className="page-heading"><div><span className="section-kicker">PREFERENCE INTELLIGENCE</span><h1>Your preference profile</h1><p>Edit explicit signals and inspect what NexaPlay AI has learned.</p></div></div>{!user ? <AuthPrompt /> : <PreferenceCenter />}</>}
          {page === "favorites" && <><div className="page-heading"><div><span className="section-kicker">STRONGEST TASTE SIGNALS</span><h1>Your favorites</h1><p>Titles you love have extra influence on personalized recommendations.</p></div></div>{!user ? <AuthPrompt /> : <FavoritesLibrary />}</>}
          {page === "rating-history" && <><div className="page-heading"><div><span className="section-kicker">RATING SIGNALS</span><h1>Your rating history</h1><p>Every explicit score used to calibrate your taste profile.</p></div></div>{!user ? <AuthPrompt /> : <RatingHistory />}</>}
        </div>
      </main>
    </div>
  );
}

function AuthPrompt() { return <section className="auth-prompt"><UserRound size={24} /><h2>Sign in to personalize NexaPlay</h2><p>Your profile, watchlist, and history are protected by Supabase Row Level Security.</p><Link className="primary-action" href="/auth">Sign in or create account</Link></section>; }
function EmptyState({ title }: { title: string }) { return <section className="empty-state"><Bookmark size={24} /><h2>{title}</h2><p>Discover something new and it will appear here.</p><Link className="primary-action" href="/discover">Explore catalog</Link></section>; }
