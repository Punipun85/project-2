"use client";

import type { EntertainmentContent } from "@/lib/catalog";
import { ContentCard } from "./content-card";

export function RecommendationCard(props: {
  item: EntertainmentContent;
  saved?: boolean;
  onOpen?: () => void;
  onWatchlist?: () => void;
}) {
  return (
    <div className="recommendation-card">
      <ContentCard {...props} />
      <p className="recommendation-reason">{props.item.reason}</p>
    </div>
  );
}
