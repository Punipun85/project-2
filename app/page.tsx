"use client";
/* eslint-disable @next/next/no-img-element */

import {
  Bell,
  Bookmark,
  Bot,
  Check,
  ChevronRight,
  CircleUserRound,
  Clapperboard,
  Compass,
  Film,
  Heart,
  History,
  Home as HomeIcon,
  Languages,
  Menu,
  MessageCircleMore,
  MonitorPlay,
  Play,
  Plus,
  Search,
  Send,
  Sparkles,
  Star,
  Tv,
  WandSparkles,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import {
  catalog,
  contentSubtitle,
  contentTypeLabels,
  type ContentType,
  type EntertainmentContent,
} from "@/lib/catalog";
import { semanticSearch } from "@/lib/recommendation";

type NavKey =
  | "Home"
  | "Movies"
  | "Anime"
  | "K-Drama"
  | "TV Series"
  | "Documentary"
  | "Discover"
  | "AI Assistant"
  | "Watchlist"
  | "History"
  | "Profile";

type ChatMessage = { role: "assistant" | "user"; text: string };

const fallbackPoster =
  "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=700&q=82";

const categoryNav: {
  label: NavKey;
  type?: ContentType;
  icon: typeof Film;
}[] = [
  { label: "Home", icon: HomeIcon },
  { label: "Movies", type: "movie", icon: Film },
  { label: "Anime", type: "anime", icon: Sparkles },
  { label: "K-Drama", type: "kdrama", icon: Heart },
  { label: "TV Series", type: "series", icon: Tv },
  { label: "Documentary", type: "documentary", icon: MonitorPlay },
];

const utilityNav: { label: NavKey; icon: typeof Film }[] = [
  { label: "Discover", icon: Compass },
  { label: "AI Assistant", icon: Bot },
  { label: "Watchlist", icon: Bookmark },
  { label: "History", icon: History },
  { label: "Profile", icon: CircleUserRound },
];

const sectionData = {
  recommended: catalog.slice(0, 6),
  anime: catalog.filter((item) => item.type === "anime"),
  movies: catalog.filter((item) => item.type === "movie"),
  kdrama: catalog.filter((item) => item.type === "kdrama"),
  releases: [...catalog].sort((a, b) => b.releaseYear - a.releaseYear).slice(0, 6),
};

function Poster({ item, className = "" }: { item: EntertainmentContent; className?: string }) {
  return (
    <img
      className={className}
      src={item.posterUrl}
      alt={`${item.title} poster`}
      onError={(event) => {
        event.currentTarget.src = fallbackPoster;
      }}
    />
  );
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol"><Sparkles size={15} /></span>
      <span className="brand-copy">
        Entertainment<span>AI</span>
        <small>Universal curator</small>
      </span>
    </div>
  );
}

function Sidebar({
  active,
  onNavigate,
  onAssistant,
  onOnboarding,
  mobileOpen,
  onClose,
  savedCount,
}: {
  active: NavKey;
  onNavigate: (nav: NavKey) => void;
  onAssistant: () => void;
  onOnboarding: () => void;
  mobileOpen: boolean;
  onClose: () => void;
  savedCount: number;
}) {
  const select = (label: NavKey) => {
    if (label === "AI Assistant") onAssistant();
    else onNavigate(label);
  };

  return (
    <>
      {mobileOpen && <button className="sidebar-scrim" onClick={onClose} aria-label="Close menu" />}
      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
        <Brand />
        <div className="nav-label">Explore</div>
        <nav className="nav-stack" aria-label="Entertainment categories">
          {categoryNav.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-button ${active === label ? "active" : ""}`}
              onClick={() => select(label)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <nav className="nav-stack" aria-label="Personal tools">
          {utilityNav.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-button ${active === label ? "active" : ""}`}
              onClick={() => select(label)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {label === "AI Assistant" && <i className="online-dot" />}
              {label === "Watchlist" && <b className="nav-count">{savedCount}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="taste-card">
          <div className="taste-top"><WandSparkles size={15} /><span>YOUR TASTE DNA</span></div>
          <strong>Emotional Explorer</strong>
          <p>Sci-fi scale, human stories, and bittersweet romance.</p>
          <div className="taste-progress"><span /></div>
          <button onClick={onOnboarding}>Refine preferences <ChevronRight size={13} /></button>
        </div>
        <button className="upgrade-button"><Sparkles size={13} /> Upgrade to Pro</button>
      </aside>
    </>
  );
}

function ContentCard({
  item,
  saved,
  onSave,
  onOpen,
  compact = false,
}: {
  item: EntertainmentContent;
  saved: boolean;
  onSave: () => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <article className={`content-card ${compact ? "compact" : ""}`}>
      <button className="poster-button" onClick={onOpen} aria-label={`Open ${item.title}`}>
        <div className="poster-frame">
          <Poster item={item} className="content-poster" />
          <div className="poster-shade" />
          <span className="type-chip" data-type={item.type}>{contentTypeLabels[item.type]}</span>
          <span className="match-chip"><Sparkles size={10} /> {item.match}%</span>
          <span className="quick-play"><Play size={15} fill="currentColor" /></span>
        </div>
      </button>
      <div className="card-copy">
        <div className="card-title-row">
          <button className="card-title" onClick={onOpen}>{item.title}</button>
          <button
            className={`save-button ${saved ? "saved" : ""}`}
            onClick={onSave}
            aria-label={saved ? `Remove ${item.title} from watchlist` : `Add ${item.title} to watchlist`}
          >
            <Bookmark size={14} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
        <p>{contentSubtitle(item)}</p>
      </div>
    </article>
  );
}

function ContentRow({
  kicker,
  title,
  items,
  savedIds,
  onSave,
  onOpen,
  onViewAll,
}: {
  kicker: string;
  title: string;
  items: EntertainmentContent[];
  savedIds: string[];
  onSave: (id: string) => void;
  onOpen: (item: EntertainmentContent) => void;
  onViewAll?: () => void;
}) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div><span>{kicker}</span><h2>{title}</h2></div>
        {onViewAll && <button onClick={onViewAll}>View all <ChevronRight size={14} /></button>}
      </div>
      <div className="content-grid">
        {items.map((item) => (
          <ContentCard
            key={item.id}
            item={item}
            saved={savedIds.includes(item.id)}
            onSave={() => onSave(item.id)}
            onOpen={() => onOpen(item)}
          />
        ))}
      </div>
    </section>
  );
}

function ContinueWatching({ items, onOpen }: { items: EntertainmentContent[]; onOpen: (item: EntertainmentContent) => void }) {
  return (
    <section className="content-section continue-section">
      <div className="section-header">
        <div><span>BACK TO YOUR STORIES</span><h2>Continue watching</h2></div>
        <button>View history <ChevronRight size={14} /></button>
      </div>
      <div className="continue-grid">
        {items.map((item) => (
          <button className="continue-card" key={item.id} onClick={() => onOpen(item)}>
            <div className="continue-art" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,11,20,.84), rgba(8,11,20,.12)), url(${item.backdropUrl})` }}>
              <span className="continue-play"><Play size={15} fill="currentColor" /></span>
              <span className="continue-copy"><b>{item.title}</b><small>{item.episodes ? `Episode ${Math.max(2, Math.round((item.progress ?? 20) / 8))}` : `${Math.round((item.progress ?? 20) / 10) * 18} min left`}</small></span>
              <span className="continue-percent">{item.progress}%</span>
              <span className="progress-track"><i style={{ width: `${item.progress}%` }} /></span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function Hero({ onOpen, onAssistant }: { onOpen: (item: EntertainmentContent) => void; onAssistant: () => void }) {
  const anime = catalog.find((item) => item.id === "anime-attack-on-titan")!;
  const movie = catalog.find((item) => item.id === "movie-interstellar")!;
  return (
    <section className="hero">
      <div className="hero-art" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,11,20,.96) 10%, rgba(8,11,20,.68) 52%, rgba(8,11,20,.18)), url(${anime.backdropUrl})` }} />
      <div className="hero-copy">
        <span className="hero-eyebrow"><Sparkles size={11} /> AI MIX OF THE WEEK</span>
        <div className="hero-pills"><span>Anime + Sci-Fi</span><span>4 seasons</span></div>
        <h1>Attack on Titan<br /><i>× Interstellar</i></h1>
        <p>Humanity&apos;s last stand meets the final frontier. Two emotionally vast stories, curated for how you watch.</p>
        <div className="hero-actions">
          <button className="primary-action" onClick={() => onOpen(anime)}><Play size={15} fill="currentColor" /> Explore the match</button>
          <button className="ghost-action" onClick={onAssistant}><MessageCircleMore size={15} /> Ask why</button>
        </div>
      </div>
      <aside className="hero-insight">
        <div className="insight-title"><Bot size={16} /><strong>AI taste insight</strong><i /></div>
        <p>Based on your recent binge of profound sci-fi and intense dark fantasy, this pair matches your love of moral conflict and spectacular scale.</p>
        <div className="signal-row"><span>Story fit</span><b>98%</b></div>
        <div className="signal-track"><i style={{ width: "98%" }} /></div>
        <div className="signal-row"><span>Emotional tone</span><b>94%</b></div>
        <div className="signal-track cyan"><i style={{ width: "94%" }} /></div>
        <button onClick={() => onOpen(movie)}>Compare both titles <ChevronRight size={13} /></button>
      </aside>
    </section>
  );
}

function AIPicks({ onOpen }: { onOpen: (item: EntertainmentContent) => void }) {
  const picks = [catalog[4], catalog[8], catalog[12]];
  return (
    <section className="ai-picks">
      <div className="ai-picks-copy">
        <span><WandSparkles size={14} /> TONIGHT&apos;S AI CURATION</span>
        <h2>Three moods.<br />One perfect night.</h2>
        <p>Lumi balanced your recent activity with something familiar, something emotional, and one intelligent surprise.</p>
        <button className="ghost-action">Refresh my picks <Sparkles size={14} /></button>
      </div>
      <div className="ai-pick-list">
        {picks.map((item, index) => (
          <button key={item.id} className="ai-pick-item" onClick={() => onOpen(item)}>
            <span className="pick-number">0{index + 1}</span>
            <Poster item={item} />
            <span className="pick-copy"><small>{["EPIC", "EMOTIONAL", "SMART SURPRISE"][index]}</small><strong>{item.title}</strong><em>{item.reason}</em></span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}

function DetailModal({
  item,
  saved,
  rating,
  onClose,
  onSave,
  onRate,
}: {
  item: EntertainmentContent;
  saved: boolean;
  rating: number;
  onClose: () => void;
  onSave: () => void;
  onRate: (value: number) => void;
}) {
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <article className="detail-modal" role="dialog" aria-modal="true" aria-label={`${item.title} details`}>
        <button className="modal-close" onClick={onClose} aria-label="Close details"><X size={18} /></button>
        <div className="detail-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,11,20,.98) 8%, rgba(8,11,20,.72) 55%, rgba(8,11,20,.24)), url(${item.backdropUrl})` }}>
          <Poster item={item} className="detail-poster" />
          <div className="detail-heading">
            <span className="type-chip" data-type={item.type}>{contentTypeLabels[item.type]}</span>
            <h2>{item.title}</h2>
            {item.originalTitle && <h3>{item.originalTitle}</h3>}
            <p>{item.description}</p>
            <div className="detail-actions"><button className="primary-action"><Play size={15} fill="currentColor" /> Watch trailer</button><button className={`ghost-action ${saved ? "selected" : ""}`} onClick={onSave}><Bookmark size={15} fill={saved ? "currentColor" : "none"} /> {saved ? "In watchlist" : "Add to watchlist"}</button></div>
          </div>
        </div>
        <div className="detail-body">
          <div className="detail-facts">
            <div><span>Rating</span><strong><Star size={13} fill="currentColor" /> {item.rating}</strong></div>
            <div><span>Release</span><strong>{item.releaseYear}</strong></div>
            {item.episodes && <div><span>Episodes</span><strong>{item.episodes}</strong></div>}
            {item.duration && <div><span>Duration</span><strong>{item.duration} min</strong></div>}
            <div><span>Language</span><strong>{item.language}</strong></div>
            <div><span>Country</span><strong>{item.country}</strong></div>
          </div>
          <div className="reason-panel"><span><Bot size={15} /> WHY AI RECOMMENDS THIS</span><p>{item.reason}</p><div className="reason-tags">{item.themes.slice(0, 4).map((theme) => <i key={theme}>{theme}</i>)}</div></div>
          <div className="detail-columns">
            <div><span>Genre</span><p>{item.genres.join(" · ")}</p></div>
            <div><span>{item.type === "anime" ? "Studio / source" : "Director / studio"}</span><p>{[item.studio, item.sourceMaterial ?? item.director].filter(Boolean).join(" · ") || "Editorial metadata pending"}</p></div>
            <div><span>Cast</span><p>{item.cast.join(", ")}</p></div>
          </div>
          <div className="rating-bar"><div><span>YOUR RATING</span><p>Every rating makes your cross-category profile smarter.</p></div><div className="rating-stars">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={value <= rating ? "rated" : ""} onClick={() => onRate(value)} aria-label={`Rate ${value} stars`}><Star size={21} fill={value <= rating ? "currentColor" : "none"} /></button>)}</div></div>
        </div>
      </article>
    </div>
  );
}

function AssistantPanel({ onClose, onOpenContent }: { onClose: () => void; onOpenContent: (item: EntertainmentContent) => void }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Tell me what you want to feel. I can search across movies, anime, K-drama, series, and documentaries." },
  ]);
  const [recommendations, setRecommendations] = useState<EntertainmentContent[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", text: message }]);
    setLoading(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, userId: "demo-user" }),
      });
      if (!response.ok) throw new Error("AI request failed");
      const payload = (await response.json()) as { answer: string; recommendations: { id: string }[] };
      const items = payload.recommendations
        .map((result) => catalog.find((item) => item.id === result.id))
        .filter((item): item is EntertainmentContent => Boolean(item));
      setRecommendations(items);
      setMessages((current) => [...current, { role: "assistant", text: payload.answer }]);
    } catch {
      const matches = semanticSearch(catalog, message, 3);
      setRecommendations(matches.map((result) => result.content));
      setMessages((current) => [...current, { role: "assistant", text: matches[0]?.reason ?? "Try adding a content type, language, theme, or mood." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="assistant-panel" aria-label="EntertainmentAI Assistant">
      <header><div className="assistant-identity"><span><Sparkles size={17} /></span><div><strong>Lumi <i>AI</i></strong><small><b /> Universal entertainment guide</small></div></div><button onClick={onClose} aria-label="Close assistant"><X size={18} /></button></header>
      <div className="memory-strip"><Bot size={15} /><p>I remember your love for intelligent protagonists, Korean romance, and emotionally rich sci-fi.</p></div>
      <div className="messages">
        {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`message ${message.role}`}><span>{message.role === "assistant" ? "✦" : "AR"}</span><p>{message.text}</p></div>)}
        {loading && <div className="message assistant"><span>✦</span><p className="thinking">Searching every universe<span>...</span></p></div>}
        {recommendations.length > 0 && <div className="chat-results">{recommendations.map((item) => <button key={item.id} onClick={() => onOpenContent(item)}><Poster item={item} /><span><b>{item.title}</b><small>{contentTypeLabels[item.type]} · {item.match}% match</small></span><ChevronRight size={14} /></button>)}</div>}
      </div>
      <div className="prompt-chips"><button onClick={() => setInput("Anime with a genius protagonist")}>Genius anime lead</button><button onClick={() => setInput("Emotional Korean romance with a bittersweet ending")}>Emotional K-drama</button></div>
      <form className="assistant-form" onSubmit={submit}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask across every category..." aria-label="Ask EntertainmentAI" /><button type="submit" aria-label="Send request"><Send size={15} /></button></form>
      <small className="assistant-note">Recommendations use your taste profile and universal hybrid scoring.</small>
    </aside>
  );
}

function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [types, setTypes] = useState(["Movies", "Anime", "K-Drama", "TV Series"]);
  const [languages, setLanguages] = useState(["English", "Japanese", "Korean"]);
  const [genres, setGenres] = useState(["Sci-Fi", "Drama", "Romance", "Action"]);
  const options = step === 0
    ? ["Movies", "Anime", "K-Drama", "TV Series", "Documentary"]
    : step === 1
      ? ["English", "Japanese", "Korean", "Chinese", "Spanish"]
      : ["Sci-Fi", "Drama", "Romance", "Action", "Fantasy", "Mystery", "Comedy", "Thriller"];
  const selected = step === 0 ? types : step === 1 ? languages : genres;
  const setSelected = step === 0 ? setTypes : step === 1 ? setLanguages : setGenres;
  const toggle = (value: string) => setSelected((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  return (
    <div className="modal-scrim">
      <section className="onboarding-modal" role="dialog" aria-modal="true" aria-label="Refine your preferences">
        <button className="modal-close" onClick={onClose} aria-label="Close onboarding"><X size={18} /></button>
        <span className="onboarding-kicker"><Sparkles size={14} /> TASTE CALIBRATION</span>
        <div className="stepper">{[0, 1, 2].map((value) => <i key={value} className={value <= step ? "active" : ""} />)}</div>
        <h2>{step === 0 ? "What do you watch?" : step === 1 ? "Which voices feel like home?" : "What pulls you into a story?"}</h2>
        <p>{step === 0 ? "Choose every format you want in your universe." : step === 1 ? "We will prioritize these languages, not limit your discovery." : "Pick at least three genres to sharpen your first recommendations."}</p>
        <div className="preference-options">{options.map((option) => <button key={option} className={selected.includes(option) ? "selected" : ""} onClick={() => toggle(option)}>{selected.includes(option) && <Check size={14} />}{option}</button>)}</div>
        <footer><button className="ghost-action" onClick={() => step > 0 ? setStep(step - 1) : onClose()}>{step > 0 ? "Back" : "Maybe later"}</button><button className="primary-action" onClick={() => step < 2 ? setStep(step + 1) : onClose()}>{step < 2 ? "Continue" : "Save my universe"}<ChevronRight size={14} /></button></footer>
      </section>
    </div>
  );
}

function ProfileView({ onEdit }: { onEdit: () => void }) {
  return (
    <section className="profile-view">
      <div className="profile-hero"><span className="profile-avatar">AR</span><div><span className="section-kicker">TASTE IDENTITY</span><h1>The Emotional Explorer</h1><p>You look for intimate human truths inside ambitious worlds.</p></div><button className="primary-action" onClick={onEdit}><WandSparkles size={15} /> Refine taste</button></div>
      <div className="profile-panels">
        <article><span><Clapperboard size={16} /> FAVORITE FORMATS</span><div className="profile-tags"><i>Movies 32%</i><i>Anime 28%</i><i>K-Drama 24%</i><i>Series 16%</i></div></article>
        <article><span><Languages size={16} /> LANGUAGE MIX</span><div className="language-bars"><p>English <i><b style={{ width: "88%" }} /></i></p><p>Japanese <i><b style={{ width: "76%" }} /></i></p><p>Korean <i><b style={{ width: "69%" }} /></i></p></div></article>
        <article><span><Sparkles size={16} /> CORE THEMES</span><div className="profile-tags"><i>Moral ambiguity</i><i>First love</i><i>Found family</i><i>Big ideas</i><i>Redemption</i></div></article>
      </div>
    </section>
  );
}

export default function Home() {
  const [active, setActive] = useState<NavKey>("Home");
  const [query, setQuery] = useState("");
  const [savedIds, setSavedIds] = useState(["anime-attack-on-titan", "movie-dune-two", "kdrama-moving"]);
  const [ratings, setRatings] = useState<Record<string, number>>({ "movie-interstellar": 5, "anime-attack-on-titan": 5 });
  const [selected, setSelected] = useState<EntertainmentContent | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const searchResults = useMemo(() => query.trim() ? semanticSearch(catalog, query, 12).map((result) => result.content) : [], [query]);
  const activeType = categoryNav.find((item) => item.label === active)?.type;
  const libraryItems = useMemo(() => {
    if (activeType) return catalog.filter((item) => item.type === activeType);
    if (active === "Watchlist") return catalog.filter((item) => savedIds.includes(item.id));
    if (active === "History") return catalog.filter((item) => item.progress);
    return catalog;
  }, [active, activeType, savedIds]);

  const toggleSaved = (id: string) => setSavedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const navigate = (nav: NavKey) => { setActive(nav); setQuery(""); setMobileOpen(false); };
  const openCategory = (nav: NavKey) => navigate(nav);

  const libraryTitle = active === "Watchlist"
    ? "Your watchlist"
    : active === "History"
      ? "Continue your stories"
      : active === "Discover"
        ? "Discover every universe"
        : active;

  return (
    <div className="entertainment-app">
      <Sidebar active={active} onNavigate={navigate} onAssistant={() => setAssistantOpen(true)} onOnboarding={() => setOnboardingOpen(true)} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} savedCount={savedIds.length} />
      <main className="main-shell">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
          <div className="universal-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search movies, anime, dramas, themes..." aria-label="Universal entertainment search" />{query ? <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button> : <kbd>⌘ K</kbd>}</div>
          <div className="topbar-tools"><button className="ask-top" onClick={() => setAssistantOpen(true)}><Sparkles size={14} /> Ask Lumi</button><div className="notification-wrap"><button className="icon-button" onClick={() => setNotificationsOpen((value) => !value)} aria-label="Notifications"><Bell size={17} /><i /></button>{notificationsOpen && <div className="notification-popover"><strong>New signals</strong><p><Sparkles size={13} /> Your anime profile is getting sharper.</p><p><Plus size={13} /> 8 new Korean dramas match your taste.</p></div>}</div><span className="user-avatar">AR</span></div>
        </header>
        <div className="page-wrap">
          {query ? (
            <section className="search-view">
              <div className="page-heading"><div><span className="section-kicker">UNIVERSAL SEMANTIC SEARCH</span><h1>Results for “{query}”</h1><p>Meaning-first matches across every entertainment category.</p></div><span className="search-signal"><Sparkles size={13} /> {searchResults.length} intelligent matches</span></div>
              {searchResults.length ? <div className="library-grid">{searchResults.map((item) => <ContentCard key={item.id} item={item} saved={savedIds.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => setSelected(item)} />)}</div> : <div className="empty-state"><Search size={24} /><h2>No strong signal yet</h2><p>Try a mood, character archetype, language, or a title you already love.</p></div>}
            </section>
          ) : active === "Home" ? (
            <>
              <div className="home-heading"><div><span className="section-kicker">MONDAY · YOUR DAILY SIGNAL</span><h1>Your universe, <i>curated.</i></h1><p>Movies, anime, drama, and series connected by how they make you feel.</p></div><button className="mood-trigger" onClick={() => setAssistantOpen(true)}><WandSparkles size={14} /> Set tonight&apos;s mood <ChevronRight size={13} /></button></div>
              <Hero onOpen={setSelected} onAssistant={() => setAssistantOpen(true)} />
              <ContinueWatching items={catalog.filter((item) => item.progress)} onOpen={setSelected} />
              <ContentRow kicker="UNIVERSAL HYBRID PICKS" title="Recommended for you" items={sectionData.recommended} savedIds={savedIds} onSave={toggleSaved} onOpen={setSelected} onViewAll={() => openCategory("Discover")} />
              <ContentRow kicker="BECAUSE YOU LIKE ANIME" title="Complex worlds, unforgettable characters" items={sectionData.anime} savedIds={savedIds} onSave={toggleSaved} onOpen={setSelected} onViewAll={() => openCategory("Anime")} />
              <div className="split-sections"><ContentRow kicker="TRENDING MOVIES" title="Big-screen energy" items={sectionData.movies} savedIds={savedIds} onSave={toggleSaved} onOpen={setSelected} onViewAll={() => openCategory("Movies")} /><ContentRow kicker="POPULAR K-DRAMA" title="Stories with heart" items={sectionData.kdrama} savedIds={savedIds} onSave={toggleSaved} onOpen={setSelected} onViewAll={() => openCategory("K-Drama")} /></div>
              <ContentRow kicker="NEW ACROSS YOUR LANGUAGES" title="New releases" items={sectionData.releases} savedIds={savedIds} onSave={toggleSaved} onOpen={setSelected} onViewAll={() => openCategory("Discover")} />
              <AIPicks onOpen={setSelected} />
            </>
          ) : active === "Profile" ? (
            <ProfileView onEdit={() => setOnboardingOpen(true)} />
          ) : (
            <section className="library-view">
              <div className="page-heading"><div><span className="section-kicker">ENTERTAINMENTAI LIBRARY</span><h1>{libraryTitle}</h1><p>{activeType ? `Curated ${contentTypeLabels[activeType].toLowerCase()} picks ranked for your language, mood, and taste.` : active === "Watchlist" ? "Everything you saved across every category." : active === "History" ? "Pick up where you left off, across every screen." : "Browse across format, language, country, mood, and theme."}</p></div>{active === "Discover" && <div className="filter-pills"><button className="selected">For you</button><button>Trending</button><button>New</button></div>}</div>
              {libraryItems.length ? <div className="library-grid">{libraryItems.map((item) => <ContentCard key={item.id} item={item} saved={savedIds.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => setSelected(item)} />)}</div> : <div className="empty-state"><Bookmark size={24} /><h2>Your watchlist is ready for a first story</h2><p>Save anything from Movies, Anime, K-Drama, Series, or Documentary.</p><button className="primary-action" onClick={() => navigate("Discover")}>Explore everything</button></div>}
            </section>
          )}
        </div>
      </main>
      {assistantOpen && <AssistantPanel onClose={() => setAssistantOpen(false)} onOpenContent={(item) => { setAssistantOpen(false); setSelected(item); }} />}
      {onboardingOpen && <OnboardingModal onClose={() => setOnboardingOpen(false)} />}
      {selected && <DetailModal item={selected} saved={savedIds.includes(selected.id)} rating={ratings[selected.id] ?? 0} onClose={() => setSelected(null)} onSave={() => toggleSaved(selected.id)} onRate={(value) => setRatings((current) => ({ ...current, [selected.id]: value }))} />}
    </div>
  );
}
