# Supabase `contents` schema

The migration in
`supabase/migrations/202609010001_create_contents.sql` creates the unified
EntertainmentAI catalog and three idempotent sample records.

## Design choices

- `content_type` is a PostgreSQL enum so ingestion cannot introduce accidental
  category spellings. The normalized TV value is `tv_series`.
- `source` remains text so new providers can be added without an enum migration.
  A canonical uppercase check keeps `(source, external_id)` deduplication
  reliable.
- Variable and provider-specific collections use JSONB arrays. This supports
  simple string values today and richer objects with names, roles, characters,
  ordering, language, or external IDs later. JSONB GIN indexes accelerate
  containment filters for genres, themes, and moods.
- The required `cast` column is declared as `"cast"` because `CAST` is a SQL
  keyword. Supabase REST responses still expose the property normally as
  `cast`; quote it only when writing raw SQL identifiers.
- Ratings use a consistent 0–10 scale. The ingestion pipeline should normalize
  source-specific scores before writing `rating_average` and preserve IMDb and
  MyAnimeList values in their dedicated fields.
- `created_at` and `updated_at` use `timestamptz`, the timezone-safe PostgreSQL
  equivalent of a timestamp. A trigger refreshes `updated_at` for every update.

## Search and recommendation

`search_document` is a stored, weighted `tsvector`: title has weight A, while
overview, genres, and themes have weight B. Its GIN index supports full-text
retrieval. A trigram title index handles fuzzy title matching.

`embedding` is `vector(384)`, matching the Sentence Transformer profile in this
project. The partial HNSW cosine index excludes rows that have not been embedded
yet. `match_contents(...)` is an RLS-aware Supabase RPC suitable for semantic
search and RAG retrieval. The application can blend its similarity value with
content, collaborative, popularity, and rating features for hybrid ranking.

If the production embedding model does not emit 384 dimensions, change both
the column and `match_contents` argument before applying the migration.

## Row Level Security

Anonymous and authenticated Supabase clients may select only active records.
They receive no direct insert, update, or delete grants. Catalog ingestion and
AI enrichment should run in a trusted backend with the Supabase `service_role`,
which bypasses RLS. The service-role key must never be exposed in browser code.

## Apply

Apply through the Supabase CLI migration workflow or paste the migration into
the Supabase SQL editor for a new project. The migration enables `vector` and
`pg_trgm`, creates the schema, indexes, trigger, vector RPC, RLS policy, grants,
and the three requested examples.
