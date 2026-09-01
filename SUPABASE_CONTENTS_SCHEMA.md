# Supabase `contents` schema

The migrations in `supabase/migrations` create the unified EntertainmentAI
catalog, apply the revised content taxonomy, and add five idempotent sample
records.

## Design choices

- `content_type` stores the stable top-level categories `movie`, `series`,
  `anime`, `documentary`, and `special`. A check constraint rejects unknown
  values while keeping the column straightforward for APIs and future schema
  evolution.
- `series_type` stores detailed episodic classifications such as `tv_series`,
  `streaming_series`, `kdrama`, `jdrama`, `cdrama`, `limited_series`, and the
  anime-specific values. A consistency constraint prevents a series subtype
  from being attached to the wrong top-level category.
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
overview, genres, themes, and keywords have weight B. Its GIN index supports
full-text retrieval. A trigram title index handles fuzzy title matching.

`embedding` is `vector(384)`, matching the Sentence Transformer profile in this
project. The partial HNSW cosine index excludes rows that have not been embedded
yet. `match_contents(...)` is an RLS-aware Supabase RPC suitable for semantic
search and RAG retrieval. The application can blend its similarity value with
content, collaborative, popularity, and rating features for hybrid ranking.

If the production embedding model does not emit 384 dimensions, change both
the column and `match_contents` argument before applying the migration.

## Row Level Security

Anonymous Supabase clients may select active records only. Authenticated users
may read the full catalog. Authenticated administrators with the trusted JWT
claim `app_metadata.role = admin` receive CRUD access through RLS. Catalog
ingestion and AI enrichment may also run in a trusted backend with the Supabase
`service_role`, which bypasses RLS. The service-role key must never be exposed
in browser code.

## Apply

Apply through the Supabase CLI migration workflow. The migrations enable
`vector` and `pg_trgm`, create the schema, revised taxonomy, indexes, trigger,
vector RPC, RLS policies, grants, and the five requested examples.
