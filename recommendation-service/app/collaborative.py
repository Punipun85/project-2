"""User-neighborhood collaborative filtering over implicit and explicit events."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any


EVENT_WEIGHTS = {
    "view": 0.15,
    "click": 0.10,
    "like": 0.90,
    "favorite": 0.90,
    "watchlist": 0.65,
    "complete": 0.80,
    "rating": 1.00,
    "not_interested": -1.00,
}


def event_strength(event: dict[str, Any]) -> float:
    event_type = str(event.get("interaction_type") or "")
    strength = EVENT_WEIGHTS.get(event_type, 0.0)
    if event_type == "rating":
        strength = (float(event.get("rating") or 0) - 3.0) / 2.0
    timestamp = event.get("created_at") or event.get("updated_at")
    recency = 0.5
    if timestamp:
        try:
            parsed = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
            days = max((datetime.now(timezone.utc) - parsed).total_seconds() / 86400, 0)
            recency = math.exp(-math.log(2) * days / 45)
        except ValueError:
            pass
    return strength * (0.65 + 0.35 * recency)


def build_affinity(events: list[dict[str, Any]]) -> dict[int, float]:
    affinity: Counter[int] = Counter()
    for event in events:
        if event.get("content_id") is not None:
            affinity[int(event["content_id"])] += event_strength(event)
    return dict(affinity)


def collaborative_scores(
    target: dict[int, float], peer_events: list[dict[str, Any]], candidate_ids: set[int]
) -> dict[int, float]:
    if not target or not peer_events:
        return {}
    peers: dict[str, dict[int, float]] = defaultdict(dict)
    for event in peer_events:
        user_id, content_id = str(event.get("user_id") or ""), event.get("content_id")
        if user_id and content_id is not None:
            item = int(content_id)
            peers[user_id][item] = peers[user_id].get(item, 0) + event_strength(event)
    target_norm = math.sqrt(sum(value * value for value in target.values()))
    weighted: Counter[int] = Counter()
    total: Counter[int] = Counter()
    for vector in peers.values():
        overlap = set(target) & set(vector)
        peer_norm = math.sqrt(sum(value * value for value in vector.values()))
        similarity = (
            sum(target[item] * vector[item] for item in overlap) / (target_norm * peer_norm)
            if overlap and target_norm and peer_norm
            else 0
        )
        if similarity <= 0:
            continue
        for item, value in vector.items():
            if item in candidate_ids and item not in target and value > 0:
                weighted[item] += similarity * value
                total[item] += similarity
    raw = {item: weighted[item] / total[item] for item in weighted if total[item] > 0}
    maximum = max(raw.values(), default=0)
    return {item: min(value / maximum, 1) for item, value in raw.items()} if maximum else {}
