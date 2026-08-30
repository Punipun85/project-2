from dataclasses import dataclass

from ..models import Content, ContentType, UserPreference


@dataclass(frozen=True)
class ScoredContent:
    content: Content
    content_score: float
    collaborative_score: float
    final_score: float
    reason: str


def _overlap(source: list[str], target: list[str]) -> float:
    if not source:
        return 0.5
    target_set = {value.lower() for value in target}
    return sum(value.lower() in target_set for value in source) / len(source)


def rank_contents(contents: list[Content], preferences: UserPreference | None, limit: int = 12) -> list[ScoredContent]:
    types = set(preferences.favorite_content_types if preferences else [])
    languages = set(preferences.preferred_languages if preferences else [])
    countries = set(preferences.favorite_countries if preferences else [])
    genres = preferences.favorite_genres if preferences else []
    themes = list((preferences.mood_profile or {}).keys()) if preferences else []

    results: list[ScoredContent] = []
    for content in contents:
        type_score = 1.0 if content.type.value in types else 0.3
        language_score = 1.0 if content.language in languages else 0.25
        country_score = 1.0 if content.country in countries else 0.35
        content_score = (
            type_score * 0.20
            + _overlap(genres, content.genre or []) * 0.30
            + language_score * 0.15
            + country_score * 0.10
            + _overlap(themes, content.themes or []) * 0.25
        )
        collaborative_score = min(1.0, (content.rating / 10) * 0.65 + (content.popularity / 100) * 0.35)
        final_score = content_score * 0.6 + collaborative_score * 0.4
        reason = _explain(content, genres, themes)
        results.append(ScoredContent(content, content_score, collaborative_score, final_score, reason))

    return sorted(results, key=lambda result: result.final_score, reverse=True)[:limit]


def infer_types(message: str) -> list[ContentType]:
    normalized = message.lower()
    mapping = {
        ContentType.ANIME: ("anime", "manga", "shonen"),
        ContentType.KDRAMA: ("k-drama", "kdrama", "korean drama"),
        ContentType.MOVIE: ("movie", "film", "nolan"),
        ContentType.SERIES: ("series", "tv show"),
        ContentType.DOCUMENTARY: ("documentary", "true story", "nature"),
    }
    return [content_type for content_type, terms in mapping.items() if any(term in normalized for term in terms)]


def semantic_rank(contents: list[Content], query: str, limit: int = 8) -> list[ScoredContent]:
    terms = {term for term in query.lower().replace("-", " ").split() if len(term) > 2}
    inferred_types = set(infer_types(query))
    scored: list[ScoredContent] = []
    for content in contents:
        searchable = " ".join([
            content.title,
            content.description,
            *(content.genre or []),
            *(content.themes or []),
            content.studio or "",
        ]).lower()
        hits = sum(term in searchable for term in terms)
        type_boost = 1.0 if content.type in inferred_types else 0.0
        content_score = min(1.0, hits / max(len(terms), 1) * 0.75 + type_boost * 0.25)
        collaborative_score = min(1.0, (content.rating / 10) * 0.65 + (content.popularity / 100) * 0.35)
        final_score = content_score * 0.6 + collaborative_score * 0.4
        if content_score > 0:
            scored.append(ScoredContent(content, content_score, collaborative_score, final_score, _explain(content, [], list(terms))))
    return sorted(scored, key=lambda result: result.final_score, reverse=True)[:limit]


def _explain(content: Content, genres: list[str], themes: list[str]) -> str:
    shared = next((genre for genre in genres if genre.lower() in {item.lower() for item in content.genre or []}), None)
    if shared:
        return f"{content.title} matches your preference for {shared.lower()} and {content.type.value} storytelling."
    if themes:
        return f"{content.title} connects with the themes in your request and has strong audience affinity."
    return f"{content.title} balances your content-type preferences with rating and popularity signals."
