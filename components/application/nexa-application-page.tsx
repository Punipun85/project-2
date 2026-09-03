"use client";

import {
  Bookmark,
  Bot,
  Compass,
  History,
  Home,
  Search,
  Sparkles,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { catalog, type EntertainmentContent } from "@/lib/catalog";
import { semanticSearch } from "@/lib/recommendation";
import { AIChatBox } from "./ai-chat-box";
import { Carousel } from "./carousel";
import { ContentCard } from "./content-card";
import { ProfilePreference, type PreferenceValue } from "./profile-preference";
import { RecommendationCard } from "./recommendation-card";

export type ApplicationPage = "home" | "discover" | "search" | "recommendations" | "ai-chat" | "profile" | "watchlist" | "history";

const navigation: Array<{ page: ApplicationPage; label: string; icon: typeof Home; href: string }> = [
  { page: "home", label: "Home", icon: Home, href: "/" },
  { page: "discover", label: "Discover", icon: Compass, href: "/discover" },
  { page: "search", label: "AI Search", icon: Search, href: "/search" },
  { page: "recommendations", label: "For You", icon: WandSparkles, href: "/recommendations" },
  { page: "ai-chat", label: "AI Assistant", icon: Bot, href: "/ai-chat" },
  { page: "watchlist", label: "Watchlist", icon: Bookmark, href: "/watchlist" },
  { page: "history", label: "History", icon: History, href: "/history" },
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

function mapRowsToCatalog(rows: Array<Record<string, unknown>>, relation = "contents") {
  return rows
    .map((row) => row[relation] as { external_id?: string } | undefined)
    .map((content) => catalog.find((item) => item.externalId === content?.external_id))
    .filter((item): item is EntertainmentContent => Boolean(item));
}

export function NexaApplicationPage({ page }: { page: ApplicationPage }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recommendations, setRecommendations] = useState<EntertainmentContent[]>(catalog.slice(0, 8));
  const [watchlist, setWatchlist] = useState<EntertainmentContent[]>([]);
  const [history, setHistory] = useState<EntertainmentContent[]>([]);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"normal" | "ai" | "character">("ai");
  const [searchResults, setSearchResults] = useState<EntertainmentContent[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void (async () => {
      const session = await fetch("/api/auth/session").then((response) => response.json()).catch(() => ({ user: null }));
      setUser(session.user ?? null);
      const recommendationPayload = await fetch("/api/recommendations?limit=12").then((response) => response.json()).catch(() => null);
      if (recommendationPayload?.data?.length) setRecommendations(recommendationPayload.data);
      if (!session.user) return;
      const [profilePayload, watchlistPayload, historyPayload] = await Promise.all([
        fetch("/api/user/profile").then((response) => response.json()),
        fetch("/api/user/watchlist").then((response) => response.json()),
        fetch("/api/user/history").then((response) => response.json()),
      ]);
      setProfile(profilePayload.data ?? null);
      setWatchlist(mapRowsToCatalog(watchlistPayload.data ?? []));
      setHistory(mapRowsToCatalog(historyPayload.data ?? []));
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
      setSearchResults(payload.data ?? []);
    })();
  }, [page]);

  const savedIds = useMemo(() => new Set(watchlist.map((item) => item.id)), [watchlist]);
  const track = (eventType: string, item?: EntertainmentContent, metadata?: Record<string, unknown>) => {
    if (!user) return;
    void fetch("/api/user/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType, externalId: item?.externalId, provider: item?.provider, metadata }),
    });
  };
  const toggleWatchlist = async (item: EntertainmentContent) => {
    if (!user) { window.location.assign("/auth"); return; }
    const saved = savedIds.has(item.id);
    const response = await fetch("/api/user/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: saved ? "remove" : "add", externalId: item.externalId, provider: item.provider }),
    });
    if (response.ok) setWatchlist((current) => saved ? current.filter((entry) => entry.id !== item.id) : [item, ...current]);
    track("watchlist", item, { action: saved ? "remove" : "add" });
  };
  const openContent = (item: EntertainmentContent) => {
    track("click", item);
    track("view", item);
    void fetch("/api/user/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: item.externalId, provider: item.provider, progress: Math.max(item.progress ?? 5, 5) }),
    });
  };
  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      if (searchMode === "ai") {
        const payload = await fetch("/api/search/semantic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, limit: 16 }) }).then((response) => response.json());
        setSearchResults(payload.data ?? []);
      } else if (searchMode === "character") {
        const normalized = query.toLowerCase();
        setSearchResults(catalog.filter((item) => item.cast.some((name) => name.toLowerCase().includes(normalized))));
      } else {
        setSearchResults(semanticSearch(catalog, query, 16).map((result) => result.content));
      }
      track("search", undefined, { query, mode: searchMode });
    } finally {
      setSearching(false);
    }
  };

  const cards = (items: EntertainmentContent[], recommended = false) => items.map((item) => recommended ? (
    <RecommendationCard key={item.id} item={item} saved={savedIds.has(item.id)} onOpen={() => openContent(item)} onWatchlist={() => toggleWatchlist(item)} />
  ) : (
    <ContentCard key={item.id} item={item} saved={savedIds.has(item.id)} onOpen={() => openContent(item)} onWatchlist={() => toggleWatchlist(item)} />
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
          {page === "home" && <><div className="home-heading"><div><span className="section-kicker">YOUR DAILY AI SIGNAL</span><h1>Your universe, <i>curated.</i></h1><p>Personal recommendations, continuing stories, and intelligent collections in one place.</p></div><Link className="mood-trigger" href="/ai-chat"><Sparkles size={14} /> Set tonight&apos;s mood</Link></div><Carousel eyebrow="HYBRID RECOMMENDATION" title="Recommended for you" href="/recommendations">{cards(recommendations.slice(0, 6), true)}</Carousel>{history.length > 0 && <Carousel eyebrow="PICK UP WHERE YOU LEFT" title="Continue watching" href="/history">{cards(history.slice(0, 6))}</Carousel>}<Carousel eyebrow="WHAT EVERYONE IS WATCHING" title="Trending now" href="/discover">{cards([...catalog].sort((a, b) => b.popularity - a.popularity).slice(0, 6))}</Carousel><section className="ai-collections"><div className="section-header"><div><span>SEMANTIC COLLECTIONS</span><h2>Explore an idea</h2></div></div><div>{["Smart characters", "Emotional anime", "Dark sci-fi"].map((collection) => <Link key={collection} href={`/search?q=${encodeURIComponent(collection)}`}><Sparkles size={16} /><strong>{collection}</strong><small>AI-curated collection</small></Link>)}</div></section></>}
          {page === "discover" && <><div className="page-heading"><div><span className="section-kicker">ALL ENTERTAINMENT</span><h1>Discover every universe</h1><p>Movies, anime, K-drama, series, and documentaries in one intelligent catalog.</p></div></div><div className="library-grid">{cards(catalog)}</div></>}
          {page === "recommendations" && <><div className="page-heading"><div><span className="section-kicker">PERSONAL AI RANKING</span><h1>Recommended for you</h1><p>Ranked from your profile, activity, content similarity, and popularity.</p></div></div>{!user && <AuthPrompt />}<div className="library-grid">{cards(recommendations, true)}</div></>}
          {page === "search" && <><div className="page-heading"><div><span className="section-kicker">MULTIMODAL DISCOVERY</span><h1>Search by title, meaning, or character</h1><p>Switch between direct catalog search and AI-powered semantic discovery.</p></div></div><form className="batch4-search" onSubmit={submitSearch}><div className="filter-pills">{(["normal", "ai", "character"] as const).map((mode) => <button type="button" key={mode} className={searchMode === mode ? "selected" : ""} onClick={() => setSearchMode(mode)}>{mode === "ai" ? "AI Semantic" : mode[0].toUpperCase() + mode.slice(1)}</button>)}</div><div><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try: dark anime with smart characters" /><button className="primary-action">{searching ? "Searching…" : "Search"}</button></div></form><div className="library-grid">{cards(searchResults)}</div></>}
          {page === "ai-chat" && <><div className="page-heading"><div><span className="section-kicker">RAG ENTERTAINMENT ASSISTANT</span><h1>Ask Lumi</h1><p>Natural conversation grounded in the NexaPlay catalog.</p></div></div><AIChatBox /></>}
          {page === "watchlist" && <><div className="page-heading"><div><span className="section-kicker">SAVED FOR LATER</span><h1>Your watchlist</h1><p>Every story you saved across all entertainment types.</p></div></div>{!user ? <AuthPrompt /> : watchlist.length ? <div className="library-grid">{cards(watchlist)}</div> : <EmptyState title="Your watchlist is empty" />}</>}
          {page === "history" && <><div className="page-heading"><div><span className="section-kicker">WATCH ACTIVITY</span><h1>History & continue watching</h1><p>Your viewing progress, synchronized securely to your account.</p></div></div>{!user ? <AuthPrompt /> : history.length ? <div className="library-grid">{cards(history)}</div> : <EmptyState title="No viewing history yet" />}</>}
          {page === "profile" && <><div className="page-heading"><div><span className="section-kicker">PERSONAL PROFILE</span><h1>Your taste dashboard</h1><p>Control the signals used to personalize NexaPlay AI.</p></div>{user && <button className="ghost-action" onClick={() => void fetch("/api/auth/logout", { method: "POST" }).then(() => { window.location.assign("/"); })}>Sign out</button>}</div>{!user ? <AuthPrompt /> : <ProfilePreference initial={{ username: profile?.username, favoriteGenres: profile?.favorite_genres, favoriteTypes: profile?.favorite_types, favoriteMoods: profile?.favorite_moods }} onSaved={(value: PreferenceValue) => setProfile({ username: value.username, favorite_genres: value.favoriteGenres, favorite_types: value.favoriteTypes, favorite_moods: value.favoriteMoods, onboarding_completed: true })} />}</>}
        </div>
      </main>
    </div>
  );
}

function AuthPrompt() { return <section className="auth-prompt"><UserRound size={24} /><h2>Sign in to personalize NexaPlay</h2><p>Your profile, watchlist, and history are protected by Supabase Row Level Security.</p><Link className="primary-action" href="/auth">Sign in or create account</Link></section>; }
function EmptyState({ title }: { title: string }) { return <section className="empty-state"><Bookmark size={24} /><h2>{title}</h2><p>Discover something new and it will appear here.</p><Link className="primary-action" href="/discover">Explore catalog</Link></section>; }
