"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { trailerEmbedUrl } from "@/lib/trailer";

export function TrailerModal({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const embed = trailerEmbedUrl(url);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  if (!embed) return null;
  return (
    <div className="trailer-modal" role="dialog" aria-modal="true" aria-label={`${title} trailer`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="trailer-player">
        <div><strong>{title}</strong><button type="button" onClick={onClose} aria-label="Close trailer"><X size={20} /></button></div>
        <iframe src={`${embed}?autoplay=1&rel=0`} title={`${title} trailer`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      </div>
    </div>
  );
}
