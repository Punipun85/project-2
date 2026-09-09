"use client";
/* eslint-disable @next/next/no-img-element */

import { Bookmark, Heart, Play, Sparkles, Star } from "lucide-react";
import type { EntertainmentContent } from "@/lib/catalog";

export function ContentCard({
  item,
  saved = false,
  favorite = false,
  onOpen,
  onWatchlist,
  onFavorite,
  showReason = false,
}: {
  item: EntertainmentContent;
  saved?: boolean;
  favorite?: boolean;
  onOpen?: () => void;
  onWatchlist?: () => void;
  onFavorite?: () => void;
  showReason?: boolean;
}) {
  return (
    <article className="content-card batch4-card">
      <button className="poster-button" onClick={onOpen} aria-label={`Open ${item.title}`}>
        <div className="poster-frame">
          <img className="content-poster" src={item.posterUrl} alt={`${item.title} poster`} />
          <div className="poster-shade" />
          <span className="type-chip" data-type={item.type}>{item.type}</span>
          <span className="match-chip"><Sparkles size={10} /> {item.match}%</span>
          <span className="quick-play"><Play size={15} fill="currentColor" /></span>
        </div>
      </button>
      <div className="card-copy">
        <div className="card-title-row">
          <button className="card-title" onClick={onOpen}>{item.title}</button>
          {onFavorite && (
            <button className={`save-button ${favorite ? "saved" : ""}`} onClick={onFavorite} aria-label={`${favorite ? "Remove" : "Add"} ${item.title} ${favorite ? "from" : "to"} favorites`}>
              <Heart size={14} fill={favorite ? "currentColor" : "none"} />
            </button>
          )}
          {onWatchlist && (
            <button className={`save-button ${saved ? "saved" : ""}`} onClick={onWatchlist} aria-label={`${saved ? "Remove" : "Add"} ${item.title} ${saved ? "from" : "to"} watchlist`}>
              <Bookmark size={14} fill={saved ? "currentColor" : "none"} />
            </button>
          )}
        </div>
        <p>{item.releaseYear} · {item.genres.slice(0, 2).join(" · ")}</p>
        <small className="batch4-rating"><Star size={11} fill="currentColor" /> {item.rating.toFixed(1)}</small>
        {showReason && <p className="search-match-reason"><Sparkles size={11} /> {item.reason}</p>}
      </div>
    </article>
  );
}
