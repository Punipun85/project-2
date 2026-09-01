# EntertainmentAI Technical Design

## Technology stack

| Layer | Technology |
| --- | --- |
| Web | React 19, TypeScript, vinext, Tailwind CSS runtime, Lucide icons |
| Edge API | Next-compatible route handlers on Cloudflare Workers |
| Domain API | FastAPI, Pydantic, SQLAlchemy |
| Edge persistence | Cloudflare D1 through Drizzle ORM |
| Primary production database | PostgreSQL |
| Catalog providers | TMDB and Jikan through the unified `data-pipeline` |
| Recommendation | Python universal hybrid engine |
| Embeddings | Sentence Transformers; ChromaDB adapter planned |
| LLM | Ollama-compatible service with deterministic fallback |

## Universal content model

`contents` replaces the movie-only concept. Provider identity is unique across `(source, external_id)` in Supabase. Arrays are JSONB in PostgreSQL and serialized JSON text in D1.

Important type-specific fields remain nullable:

- Anime: `episodes`, `season`, `studio`, `source_material`.
- Movie and documentary: `duration`, `director`.
- Drama and series: `episodes`, `season`, `studio`, `cast`.

Shared semantic features include description, genres, themes, language, country, studio, source material, director, and cast.

## Recommendation design

The ranker keeps a stable policy while allowing model components to evolve:

```text
content_score = weighted(type, genre, theme, language, country, semantic similarity)
collaborative_score = normalized(SVD/KNN signal, rating affinity, popularity prior)
final_score = 0.6 * content_score + 0.4 * collaborative_score
```

The dependency-light test engine calculates deterministic metadata similarity. Production adapters may replace individual inputs with TF-IDF, Sentence Transformer, KNN, or SVD scores without changing the API response.

## Intent and semantic search

The assistant pipeline performs:

1. Content-type detection.
2. Language and country detection.
3. Theme and character-archetype expansion.
4. Lexical and vector candidate retrieval.
5. Universal hybrid ranking.
6. LLM explanation with deterministic fallback.

Embedding text varies by content type:

- Movie: story, theme, genre, director.
- Anime: story, character archetype, power system, studio, source material.
- Drama: relationship type, emotion, conflict, language, country.

## Persistence

D1 is configured as the Sites persistence layer and ships with a Drizzle migration. FastAPI models mirror the same domain shape for PostgreSQL deployments. D1 stores structured product data; no browser storage is treated as authoritative.

## Failure behavior

- A fresh D1 database returns the curated catalog until provider sync runs.
- Jikan and TMDB failures do not block the existing catalog.
- Ollama failure returns a deterministic explanation.
- The unified `data-pipeline` runs provider synchronization outside the user request path.
- Inputs are length-limited and supported content types are allow-listed.

## Security

- API credentials come from environment variables only.
- Provider payloads are normalized before persistence.
- User-specific records are keyed by authenticated user ID in production.
- Internal sync endpoints must be protected by service authentication before public deployment.
- CORS is restricted to the web origin in the FastAPI service.

## Observability

Track latency, error rate, provider health, catalog freshness, candidate count, final-score distribution, type diversity, explanation provider, and engagement by recommendation position.
