"""Universal hybrid recommendation engine.

This module is dependency-light by design so its ranking contract can be tested
without loading the production TF-IDF, SVD, or embedding artifacts. Production
adapters can supply normalized similarity and collaborative scores while the
0.6/0.4 hybrid policy remains stable.
"""

from dataclasses import dataclass, field
from typing import Iterable


@dataclass(frozen=True)
class ContentRecord:
    id: str
    title: str
    content_type: str
    genres: tuple[str, ...]
    themes: tuple[str, ...]
    language: str
    country: str
    rating: float
    popularity: float
    studio: str = ""


@dataclass(frozen=True)
class UserTaste:
    content_types: tuple[str, ...] = ()
    genres: tuple[str, ...] = ()
    themes: tuple[str, ...] = ()
    languages: tuple[str, ...] = ()
    countries: tuple[str, ...] = ()
    liked_content_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class RankedRecommendation:
    content: ContentRecord
    content_score: float
    collaborative_score: float
    final_score: float
    explanation: str
    signals: dict[str, float] = field(default_factory=dict)


def _normal(value: str) -> str:
    return value.casefold().strip()


def _overlap(preferences: Iterable[str], features: Iterable[str], neutral: float = 0.4) -> float:
    preferred = {_normal(value) for value in preferences}
    if not preferred:
        return neutral
    available = {_normal(value) for value in features}
    return len(preferred & available) / len(preferred)


class UniversalHybridRecommender:
    content_weight = 0.6
    collaborative_weight = 0.4

    def recommend(self, taste: UserTaste, candidates: Iterable[ContentRecord], limit: int = 10) -> list[RankedRecommendation]:
        ranked: list[RankedRecommendation] = []
        excluded = set(taste.liked_content_ids)
        for content in candidates:
            if content.id in excluded:
                continue
            signals = {
                "type": 1.0 if content.content_type in taste.content_types else 0.25,
                "genre": _overlap(taste.genres, content.genres),
                "theme": _overlap(taste.themes, content.themes),
                "language": 1.0 if content.language in taste.languages else 0.25,
                "country": 1.0 if content.country in taste.countries else 0.35,
            }
            content_score = (
                signals["type"] * 0.18
                + signals["genre"] * 0.27
                + signals["theme"] * 0.30
                + signals["language"] * 0.15
                + signals["country"] * 0.10
            )
            collaborative_score = min(1.0, (content.rating / 10) * 0.65 + (content.popularity / 100) * 0.35)
            final_score = content_score * self.content_weight + collaborative_score * self.collaborative_weight
            ranked.append(
                RankedRecommendation(
                    content=content,
                    content_score=content_score,
                    collaborative_score=collaborative_score,
                    final_score=final_score,
                    explanation=self._explain(content, taste, signals),
                    signals=signals,
                )
            )
        return sorted(ranked, key=lambda result: result.final_score, reverse=True)[:limit]

    def search(self, query: str, candidates: Iterable[ContentRecord], limit: int = 10) -> list[RankedRecommendation]:
        normalized = _normal(query).replace("-", " ")
        terms = {term for term in normalized.split() if len(term) > 2}
        expanded_themes = set()
        theme_map = {
            "genius": {"genius protagonist", "strategic", "psychological"},
            "smart": {"genius protagonist", "strategic"},
            "sad": {"bittersweet", "emotional", "first love"},
            "romance": {"romance", "first love", "forbidden love"},
            "emotional": {"emotional", "family", "first love", "bittersweet"},
        }
        for term, themes in theme_map.items():
            if term in terms:
                expanded_themes.update(themes)
        content_types = tuple(
            content_type
            for content_type, keywords in {
                "anime": ("anime", "manga"),
                "kdrama": ("kdrama", "korean", "drama"),
                "movie": ("movie", "film"),
                "series": ("series", "show"),
                "documentary": ("documentary", "nature"),
            }.items()
            if any(keyword in normalized for keyword in keywords)
        )
        taste = UserTaste(content_types=content_types, themes=tuple(expanded_themes))
        lexical_scores: dict[str, float] = {}
        candidate_list = list(candidates)
        for content in candidate_list:
            searchable = _normal(" ".join((content.title, *content.genres, *content.themes, content.studio)))
            lexical_scores[content.id] = sum(term in searchable for term in terms) / max(len(terms), 1)
        ranked = self.recommend(taste, candidate_list, len(candidate_list))
        rescored = [
            RankedRecommendation(
                content=result.content,
                content_score=min(1.0, result.content_score * 0.7 + lexical_scores[result.content.id] * 0.3),
                collaborative_score=result.collaborative_score,
                final_score=min(1.0, result.final_score * 0.75 + lexical_scores[result.content.id] * 0.25),
                explanation=result.explanation,
                signals={**result.signals, "lexical": lexical_scores[result.content.id]},
            )
            for result in ranked
        ]
        return sorted(rescored, key=lambda result: result.final_score, reverse=True)[:limit]

    @staticmethod
    def _explain(content: ContentRecord, taste: UserTaste, signals: dict[str, float]) -> str:
        shared_themes = {_normal(value) for value in taste.themes} & {_normal(value) for value in content.themes}
        shared_genres = {_normal(value) for value in taste.genres} & {_normal(value) for value in content.genres}
        if shared_themes:
            return f"{content.title} matches your interest in {sorted(shared_themes)[0]} stories and has strong audience affinity."
        if shared_genres:
            return f"{content.title} carries the {sorted(shared_genres)[0]} tone you rate highly."
        if signals["type"] == 1.0:
            return f"{content.title} is a strong {content.content_type} match with themes adjacent to your recent activity."
        return f"{content.title} is a cross-category discovery supported by rating and popularity signals."
