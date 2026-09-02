# EntertainmentAI Product Requirements

## Product vision

EntertainmentAI is a universal, explainable entertainment recommendation platform. It helps a user move between movies, anime, K-drama, TV series, and documentaries without losing the context of their taste.

The product succeeds when a user can describe a mood, theme, character archetype, language, or known title and receive relevant cross-category recommendations with a credible explanation.

## User problems

- Entertainment catalogs are fragmented by provider and content type.
- Most recommendation systems optimize popularity rather than personal taste.
- Cross-category relationships are difficult to discover manually.
- Users cannot see why a title was selected.
- New users have insufficient behavioral data for good recommendations.

## Target users

- Viewers who consume more than one entertainment category.
- Anime and drama fans who care about studio, language, country, themes, and relationship dynamics.
- Explorers who want natural-language discovery rather than rigid filters.
- Administrators responsible for catalog sync, provider health, and recommendation quality.

## Supported content

| Type | Primary source | Important metadata |
| --- | --- | --- |
| Movie | TMDB | director, cast, runtime, themes |
| Anime | MyAnimeList API v2 | MAL ID, studio, episodes, season, source material |
| K-Drama | TMDB TV | country, language, episodes, relationship and emotional themes |
| TV Series | TMDB TV | seasons, episodes, studio, cast |
| Documentary | TMDB | subject, theme, runtime, director |

The data model is ready for Japanese and Chinese drama as future content-type or country/language facets without another catalog rewrite.

## Core journeys

### Taste onboarding

1. Select watched content types.
2. Select preferred languages.
3. Select at least three genres.
4. Generate an initial profile.
5. Enter the personalized dashboard.

### Universal discovery

1. Enter a natural-language query such as “anime with a genius protagonist.”
2. Detect type, theme, language, and entity intent.
3. Retrieve candidates using semantic and metadata search.
4. Apply the universal hybrid ranker.
5. Show recommendations and explanations.

### Feedback loop

Watchlist, ratings, watch progress, completion status, skips, and assistant memory update the user profile and future ranking.

## Dashboard requirements

- Continue Watching
- Recommended For You
- Because You Like Anime
- Trending Movies
- Popular K-Drama
- Top Anime
- New Releases
- AI Picks For Tonight

## Functional requirements

- Navigate by content category without losing the shared taste profile.
- Search across title, story, theme, character archetype, language, studio, director, and cast.
- View type-specific metadata on the content detail surface.
- Add or remove content from a universal watchlist.
- Rate content from one to five stars.
- Persist preferences, ratings, watch history, watchlist, and AI memory.
- Detect mixed-intent prompts and return cross-category results.
- Explain every AI recommendation using concrete matching signals.
- Let administrators monitor providers, sync jobs, and recommendation analytics.

## Quality and success metrics

- API p95 latency under 2 seconds for cached catalog operations.
- Search and recommendation requests succeed at least 99.5% of the time.
- Recommendation precision@10 and recall@10 tracked by content type.
- RMSE tracked for explicit rating prediction.
- Cross-category result engagement tracked independently.
- Explanation helpfulness measured through positive feedback.
- Cold-start users reach a first recommendation in under two minutes.

## Acceptance criteria for this release

- The existing MovieRecs dashboard is expanded rather than replaced by a disconnected application.
- All five content types are represented in navigation, data, search, and detail views.
- The hybrid score is `0.6 * content similarity + 0.4 * collaborative score`.
- Anime, K-drama, and cross-category recommendation tests pass.
- D1 and PostgreSQL-compatible models express the universal content schema.
- TMDB and official MyAnimeList normalization pipelines are present.
- API contracts and architecture are documented.
