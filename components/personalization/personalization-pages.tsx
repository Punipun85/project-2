"use client";
/* eslint-disable @next/next/no-img-element */

import { Check, Heart, LoaderCircle, Sparkles, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProfilePreference, type PreferenceValue } from "@/components/application/profile-preference";

type InitialContent = {
  id: number;
  title: string;
  poster_url?: string | null;
  content_type?: string;
  genres?: string[];
  rating_average?: number;
  release_year?: number;
};

type RelatedContent = {
  id?: number;
  external_id?: string;
  source?: string;
  title?: string;
  poster_url?: string;
  content_type?: string;
  rating_average?: number;
};

type RelatedRow = {
  id?: number;
  content_id?: number;
  rating?: number;
  created_at?: string;
  updated_at?: string;
  contents?: RelatedContent | RelatedContent[];
};

const related = (row: RelatedRow) =>
  (Array.isArray(row.contents) ? row.contents[0] : row.contents) ?? {};

export function OnboardingFlow() {
  const [step, setStep] = useState(1);
  const [genres, setGenres] = useState<string[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [contents, setContents] = useState<InitialContent[]>([]);
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [status, setStatus] = useState("Loading your calibration…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/user/onboarding")
      .then(async (response) => {
        if (response.status === 401) return window.location.assign("/auth/login");
        const payload = await response.json();
        if (payload.data?.completed) return window.location.assign("/dashboard");
        setOptions(payload.data?.genres ?? []);
        setContents(payload.data?.contents ?? []);
        setGenres(payload.data?.favoriteGenres ?? []);
        setStatus("");
      })
      .catch(() => setStatus("Could not load onboarding. Please try again."));
  }, []);

  const ratedCount = Object.keys(ratings).length;
  const toggleGenre = (genre: string) => {
    setGenres((current) =>
      current.includes(genre) ? current.filter((item) => item !== genre) : [...current, genre],
    );
  };
  const complete = async () => {
    if (ratedCount < 5) return setStatus("Rate at least 5 titles to continue.");
    setSaving(true);
    setStatus("Building your taste profile and preference vector…");
    const response = await fetch("/api/user/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        favoriteGenres: genres,
        ratings: Object.entries(ratings).map(([contentId, rating]) => ({
          contentId: Number(contentId),
          rating,
        })),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok) return window.location.assign("/dashboard");
    setStatus(payload?.error ?? "Could not complete onboarding.");
    setSaving(false);
  };

  return (
    <main className="personalization-onboarding">
      <section className="onboarding-card">
        <header>
          <span className="onboarding-brand"><Sparkles size={16} /> NEXAPLAY AI</span>
          <div className="personalization-step"><i className="active" /><i className={step === 2 ? "active" : ""} /></div>
          <small>STEP {step} OF 2 · TASTE CALIBRATION</small>
          <h1>{step === 1 ? "Choose your favorite worlds" : "Teach us with five ratings"}</h1>
          <p>{step === 1 ? "Pick at least three genres. These become the first signals in your personal recommendation universe." : "Rate titles from one to five stars. Your ratings shape both your taste profile and user embedding."}</p>
        </header>

        {step === 1 ? (
          <div className="onboarding-genres">
            {options.map((genre) => (
              <button type="button" key={genre} className={genres.includes(genre) ? "selected" : ""} onClick={() => toggleGenre(genre)}>
                {genres.includes(genre) && <Check size={15} />}{genre}
              </button>
            ))}
          </div>
        ) : (
          <div className="onboarding-ratings">
            {contents.map((item) => (
              <article key={item.id}>
                <img src={item.poster_url ?? ""} alt="" />
                <div><strong>{item.title}</strong><small>{item.content_type} · {item.release_year ?? "—"}</small></div>
                <div className="inline-stars" aria-label={`Rate ${item.title}`}>
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button type="button" key={rating} className={rating <= (ratings[item.id] ?? 0) ? "rated" : ""} onClick={() => setRatings((current) => ({ ...current, [item.id]: rating }))} aria-label={`${rating} stars`}>
                      <Star size={17} fill={rating <= (ratings[item.id] ?? 0) ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}

        <footer>
          <span>{status || (step === 1 ? `${genres.length}/3 minimum selected` : `${ratedCount}/5 minimum rated`)}</span>
          <div>
            {step === 2 && <button className="ghost-action" type="button" onClick={() => setStep(1)}>Back</button>}
            {step === 1 ? (
              <button className="primary-action" type="button" disabled={genres.length < 3} onClick={() => { setStatus(""); setStep(2); }}>Continue</button>
            ) : (
              <button className="primary-action" type="button" disabled={ratedCount < 5 || saving} onClick={complete}>{saving && <LoaderCircle className="auth-spinner" size={15} />}Create my profile</button>
            )}
          </div>
        </footer>
      </section>
    </main>
  );
}

export function PreferenceCenter() {
  const [preferences, setPreferences] = useState<PreferenceValue>();
  const [taste, setTaste] = useState<{ genre_scores?: Record<string, number>; styles?: string[] } | null>(null);
  useEffect(() => {
    void Promise.all([
      fetch("/api/user/preferences").then((response) => response.json()),
      fetch("/api/user/taste-profile").then((response) => response.json()),
      fetch("/api/user/profile").then((response) => response.json()),
    ]).then(([preferencePayload, tastePayload, profilePayload]) => {
      const row = preferencePayload.data ?? {};
      setPreferences({
        username: profilePayload.data?.username ?? "",
        favoriteGenres: row.favorite_genres ?? [],
        favoriteTypes: row.favorite_types ?? [],
        favoriteMoods: row.favorite_moods ?? [],
      });
      setTaste(tastePayload.data);
    });
  }, []);
  if (!preferences) return <p className="personalization-loading"><LoaderCircle className="auth-spinner" size={16} /> Loading preference profile…</p>;
  return (
    <div className="personalization-grid">
      <ProfilePreference initial={preferences} onSaved={() => window.location.reload()} />
      <TasteSnapshot taste={taste} />
    </div>
  );
}

function TasteSnapshot({ taste }: { taste: { genre_scores?: Record<string, number>; styles?: string[] } | null }) {
  const scores = useMemo(() => Object.entries(taste?.genre_scores ?? {}).slice(0, 8), [taste]);
  return (
    <aside className="taste-snapshot">
      <span className="section-kicker"><Sparkles size={13} /> AI TASTE PROFILE</span>
      <h2>What NexaPlay understands</h2>
      {scores.length ? scores.map(([genre, score]) => <div className="taste-score" key={genre}><p><span>{genre}</span><b>{Math.round(score * 100)}%</b></p><i><b style={{ width: `${score * 100}%` }} /></i></div>) : <p className="muted-copy">Complete onboarding or rate content to build your profile.</p>}
      <div className="taste-styles">{taste?.styles?.map((style) => <span key={style}>{style}</span>)}</div>
    </aside>
  );
}

export function RatingHistory() {
  const [rows, setRows] = useState<RelatedRow[] | null>(null);
  useEffect(() => { void fetch("/api/user/ratings").then((response) => response.json()).then((payload) => setRows(payload.data ?? [])); }, []);
  if (!rows) return <p className="personalization-loading">Loading ratings…</p>;
  return <div className="activity-list">{rows.length ? rows.map((row) => { const item = related(row); return <article key={row.id}><img src={item.poster_url ?? ""} alt="" /><div><strong>{item.title}</strong><small>{item.content_type} · Rated {new Date(row.updated_at ?? row.created_at ?? "").toLocaleDateString()}</small></div><span className="rating-value"><Star size={15} fill="currentColor" /> {row.rating}/5</span></article>; }) : <p className="muted-copy">Your ratings will appear here after onboarding.</p>}</div>;
}

export function FavoritesLibrary() {
  const [rows, setRows] = useState<RelatedRow[] | null>(null);
  useEffect(() => { void fetch("/api/user/favorites").then((response) => response.json()).then((payload) => setRows(payload.data ?? [])); }, []);
  const remove = async (row: RelatedRow) => {
    const response = await fetch("/api/user/favorites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", contentId: row.content_id }) });
    if (response.ok) setRows((current) => current?.filter((item) => item.content_id !== row.content_id) ?? []);
  };
  if (!rows) return <p className="personalization-loading">Loading favorites…</p>;
  return <div className="activity-list">{rows.length ? rows.map((row) => { const item = related(row); return <article key={row.id}><img src={item.poster_url ?? ""} alt="" /><div><strong>{item.title}</strong><small>{item.content_type} · Added {new Date(row.created_at ?? "").toLocaleDateString()}</small></div><button className="ghost-action" onClick={() => remove(row)}><Heart size={14} fill="currentColor" /> Remove</button></article>; }) : <p className="muted-copy">No favorites yet. Add one from a content detail view.</p>}</div>;
}
