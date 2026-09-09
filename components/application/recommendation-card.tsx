"use client";

import type { EntertainmentContent } from "@/lib/catalog";
import { ContentCard } from "./content-card";

export function RecommendationCard(props: {
  item: EntertainmentContent;
  saved?: boolean;
  favorite?: boolean;
  onOpen?: () => void;
  onWatchlist?: () => void;
  onFavorite?: () => void;
}) {
  return (
    <div className="recommendation-card">
      <ContentCard {...props} />
      <p className="recommendation-reason">{props.item.reason}</p>
    </div>
  );
}
