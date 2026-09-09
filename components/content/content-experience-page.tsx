"use client";
/* eslint-disable @next/next/no-img-element */

import { Bookmark, Check, Clock3, Heart, Play, Sparkles, Star, ThumbsDown, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntertainmentContent } from "@/lib/catalog";
import type { ContentExperience } from "@/lib/content-experience";
import { trailerEmbedUrl } from "@/lib/trailer";
import { CharacterCard } from "./character-card";
import { TrailerModal } from "./trailer-modal";

type Explanation = { explanation: string; personalized: boolean };

function formatRuntime(content: ContentExperience) {
  if (content.duration) {
    const hours = Math.floor(content.duration / 60);
    const minutes = content.duration % 60;
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
  if (content.episodes) return `${content.episodes} episodes`;
  return null;
}

export function ContentExperiencePage({ id }: { id: string }) {
  const [content, setContent] = useState<ContentExperience | null>(null);
  const [similar, setSimilar] = useState<EntertainmentContent[]>([]);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/content/${encodeURIComponent(id)}`).then((response) => response.ok ? response.json() : Promise.reject(new Error("Content not found"))),
      fetch(`/api/content/${encodeURIComponent(id)}/similar`).then((response) => response.json()).catch(() => ({ data: [] })),
      fetch(`/api/content/${encodeURIComponent(id)}/explanation`).then((response) => response.json()).catch(() => ({ data: null })),
    ]).then(([detailPayload, similarPayload, explanationPayload]) => {
      if (!active) return;
      setContent(detailPayload.data);
      setSimilar(similarPayload.data ?? []);
      setExplanation(explanationPayload.data ?? null);
      setLoading(false);
      if (detailPayload.data?.userState?.authenticated) {
        const detailIdentity = /^\d+$/.test(String(detailPayload.data.id))
          ? { contentId: Number(detailPayload.data.id) }
          : { externalId: detailPayload.data.externalId, provider: detailPayload.data.provider };
        void fetch("/api/user/history", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...detailIdentity, progress: 5 }),
        });
      }
    }).catch((reason: Error) => {
      if (!active) return;
      setError(reason.message);
      setLoading(false);
    });
    return () => { active = false; };
  }, [id]);

  const requireUser = useCallback(() => {
    if (content?.userState.authenticated) return true;
    window.location.assign(`/auth/login?next=${encodeURIComponent(`/content/${id}`)}`);
    return false;
  }, [content, id]);

  const updateState = (patch: Partial<ContentExperience["userState"]>) => {
    setContent((current) => current ? { ...current, userState: { ...current.userState, ...patch } } : current);
  };
  const identity = content && /^\d+$/.test(content.id)
    ? { contentId: Number(content.id) }
    : { externalId: content?.externalId, provider: content?.provider };

  const toggleWatchlist = async () => {
    if (!content || !requireUser()) return;
    setSaving("watchlist");
    const next = !content.userState.watchlisted;
    const response = await fetch("/api/user/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: next ? "add" : "remove", ...identity }) });
    if (response.ok) { updateState({ watchlisted: next }); setNotice(next ? "Added to your watchlist." : "Removed from watchlist."); }
    setSaving("");
  };

  const toggleFavorite = async () => {
    if (!content || !requireUser()) return;
    setSaving("favorite");
    const next = !content.userState.favorite;
    const response = await fetch("/api/content/favorite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: next ? "add" : "remove", ...identity }) });
    if (response.ok) { updateState({ favorite: next }); setNotice(next ? "This title now influences your taste profile." : "Removed from favorites."); }
    setSaving("");
  };

  const markNotInterested = async () => {
    if (!content || !requireUser()) return;
    setSaving("negative");
    const response = await fetch("/api/user/interactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventType: "not_interested", ...identity, metadata: { source: "content_detail" } }) });
    if (response.ok) { updateState({ notInterested: true }); setNotice("We will reduce recommendations like this."); }
    setSaving("");
  };

  const rate = async (rating: number) => {
    if (!content || !requireUser()) return;
    setSaving("rating");
    const response = await fetch("/api/content/rating", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...identity, rating }) });
    if (response.ok) { updateState({ rating }); setNotice(`Rated ${rating}/5. Your profile has been recalibrated.`); }
    setSaving("");
  };

  const trailerAvailable = useMemo(() => Boolean(trailerEmbedUrl(content?.trailerUrl)), [content?.trailerUrl]);
  if (loading) return <ContentDetailSkeleton />;
  if (!content || error) return <main className="content-error"><Sparkles size={28} /><h1>That story slipped out of view</h1><p>{error || "Content not found."}</p><Link href="/discover">Return to Discover</Link></main>;
  const runtime = formatRuntime(content);

  return (
    <main className="content-experience">
      <section className="detail-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(5,6,13,.98) 0%, rgba(5,6,13,.74) 48%, rgba(5,6,13,.25) 100%), linear-gradient(0deg, #05060d 0%, transparent 48%), url(${content.backdropUrl})` }}>
        <Link className="detail-brand" href="/"><Sparkles size={16} /> NexaPlay <b>AI</b></Link>
        <div className="detail-hero-inner">
          <img className="detail-poster" src={content.posterUrl} alt={`${content.title} poster`} />
          <div className="detail-copy">
            <span className="detail-type">{content.type.replace("_", " ")}</span>
            <h1>{content.title}</h1>
            {content.originalTitle && content.originalTitle !== content.title && <p className="original-title">{content.originalTitle}</p>}
            <div className="detail-facts"><span className="audience-score"><Star size={15} fill="currentColor" /> {content.rating.toFixed(1)}</span><span>{content.releaseYear || "TBA"}</span>{runtime && <span><Clock3 size={14} /> {runtime}</span>}<span>{content.genres.slice(0, 3).join(" · ")}</span></div>
            <p className="detail-overview">{content.description || "Synopsis is being curated."}</p>
            <div className="detail-actions">
              {trailerAvailable && <button className="watch-trailer" type="button" onClick={() => setTrailerOpen(true)}><Play size={17} fill="currentColor" /> Watch trailer</button>}
              <button className={content.userState.watchlisted ? "action-active" : ""} disabled={saving === "watchlist"} onClick={toggleWatchlist}><Bookmark size={17} fill={content.userState.watchlisted ? "currentColor" : "none"} /> {content.userState.watchlisted ? "In watchlist" : "Add watchlist"}</button>
              <button className={content.userState.favorite ? "action-active" : ""} disabled={saving === "favorite"} onClick={toggleFavorite}><Heart size={17} fill={content.userState.favorite ? "currentColor" : "none"} /> {content.userState.favorite ? "Liked" : "Like"}</button>
              <button className={content.userState.notInterested ? "action-muted" : ""} disabled={saving === "negative" || content.userState.notInterested} onClick={markNotInterested}><ThumbsDown size={17} /> {content.userState.notInterested ? "Noted" : "Not interested"}</button>
            </div>
            <div className="detail-rating"><span>Your rating</span><div>{[1,2,3,4,5].map((value) => <button key={value} disabled={saving === "rating"} onClick={() => rate(value)} aria-label={`Rate ${value} stars`}><Star size={21} fill={value <= (content.userState.rating ?? 0) ? "currentColor" : "none"} /></button>)}</div></div>
            {notice && <p className="detail-notice"><Check size={14} /> {notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={13} /></button></p>}
          </div>
        </div>
      </section>

      <div className="detail-body">
        <section className="why-watch"><span><Sparkles size={14} /> LUMI PERSONAL MATCH</span><h2>Why you should watch this</h2>{explanation ? <p>{explanation.explanation}</p> : <div className="text-skeleton" />}{explanation?.personalized && <small>Grounded in your taste profile and viewing signals</small>}</section>

        {content.type === "anime" && content.characters.length > 0 && <section className="detail-section"><div className="detail-section-heading"><span>CHARACTER DATABASE</span><h2>Characters</h2></div><div className="character-grid">{content.characters.map((character, index) => <CharacterCard key={`${character.id ?? index}-${character.name}`} character={character} />)}</div></section>}

        <section className="detail-section crew-section"><div className="detail-section-heading"><span><UsersRound size={13} /> PEOPLE BEHIND THE STORY</span><h2>{content.type === "anime" ? "Studio & voice talent" : "Cast & crew"}</h2></div><div className="crew-columns"><CreditGroup title={content.type === "anime" ? "Voice cast" : "Cast"} names={content.castCredits.map((person) => person.character ? `${person.name} as ${person.character}` : person.name)} /><CreditGroup title="Director" names={content.creators.filter((person) => /director/i.test(person.role ?? "")).map((person) => person.name).concat(content.director && !content.creators.length ? [content.director] : [])} /><CreditGroup title={content.type === "anime" ? "Studio" : "Writers"} names={content.type === "anime" ? content.studios : content.writers.map((person) => person.name)} /></div></section>

        <section className="detail-section"><div className="detail-section-heading"><span>VECTOR + HYBRID DISCOVERY</span><h2>Because you watched {content.title}</h2></div>{similar.length ? <div className="similar-strip">{similar.slice(0, 10).map((item) => <Link href={`/content/${item.id}`} key={item.id}><div><img src={item.posterUrl} alt="" /><span>{item.match}% match</span></div><strong>{item.title}</strong><small>{item.releaseYear} · {item.genres.slice(0,2).join(" · ")}</small></Link>)}</div> : <p className="detail-empty">Similar titles will appear when vector search is available.</p>}</section>
      </div>
      {trailerOpen && content.trailerUrl && <TrailerModal title={content.title} url={content.trailerUrl} onClose={() => setTrailerOpen(false)} />}
    </main>
  );
}

function CreditGroup({ title, names }: { title: string; names: string[] }) {
  return <div><span>{title}</span>{names.length ? names.slice(0, 8).map((name) => <p key={name}>{name}</p>) : <p className="detail-empty">Not available</p>}</div>;
}

function ContentDetailSkeleton() {
  return <main className="content-experience detail-loading"><div className="hero-skeleton"><i /><div><b /><b /><b /><b /></div></div><div className="detail-body"><section className="why-watch"><div className="text-skeleton" /><div className="text-skeleton short" /></section></div></main>;
}
