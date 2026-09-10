-- NexaPlay AI Batch 1: production vector search and RAG foundation.
-- The existing 384-dimensional all-MiniLM-L6-v2 profile remains canonical.

begin;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

alter table public.contents
  add column if not exists embedding_status text not null default 'pending',
  add column if not exists embedded_at timestamptz,
  add column if not exists embedding_model text,
  add column if not exists embedding_source_hash text,
  add column if not exists embedding_error text;

alter table public.contents
  drop constraint if exists contents_embedding_status_allowed,
  drop constraint if exists contents_embedding_source_hash_format;

alter table public.contents
  add constraint contents_embedding_status_allowed check (
    embedding_status in ('pending', 'processing', 'ready', 'failed')
  ),
  add constraint contents_embedding_source_hash_format check (
    embedding_source_hash is null or embedding_source_hash ~ '^[0-9a-f]{64}$'
  );

comment on column public.contents.embedding_status is
  'Embedding lifecycle state: pending, processing, ready, or failed.';
comment on column public.contents.embedded_at is
  'Timestamp of the latest successful semantic embedding.';
comment on column public.contents.embedding_model is
  'Model identifier that produced the current contents.embedding value.';
comment on column public.contents.embedding_source_hash is
  'SHA-256 of the normalized semantic document used to detect metadata changes.';
comment on column public.contents.embedding_error is
  'Short operational error from the latest failed embedding attempt; never contains credentials.';

update public.contents
set embedding_status = case when embedding is null then 'pending' else 'ready' end,
    embedded_at = case when embedding is null then null else coalesce(embedded_at, updated_at) end,
    embedding_model = case
      when embedding is null then null
      else coalesce(embedding_model, 'sentence-transformers/all-MiniLM-L6-v2')
    end
where embedding_status is distinct from
  case when embedding is null then 'pending' else 'ready' end
  or (embedding is not null and embedding_model is null)
  or (embedding is not null and embedded_at is null);

create index if not exists contents_embedding_status_idx
  on public.contents (embedding_status, updated_at)
  where is_active = true;

-- HNSW supports cosine search immediately and does not require a training list
-- size. Keep the existing index name so repeated deployments are idempotent.
create index if not exists contents_embedding_hnsw_idx
  on public.contents using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create or replace function public.mark_contents_embedding_pending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.title is distinct from new.title
    or old.overview is distinct from new.overview
    or old.genres is distinct from new.genres
    or old.themes is distinct from new.themes
    or old.moods is distinct from new.moods
    or old.keywords is distinct from new.keywords
    or old."cast" is distinct from new."cast"
    or old.characters is distinct from new.characters
    or old.director is distinct from new.director
    or old.ai_summary is distinct from new.ai_summary then
    new.embedding_status := 'pending';
    new.embedding_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists contents_mark_embedding_pending on public.contents;
create trigger contents_mark_embedding_pending
before update of title, overview, genres, themes, moods, keywords, "cast", characters, director, ai_summary
on public.contents
for each row execute function public.mark_contents_embedding_pending();

drop function if exists public.match_contents(
  extensions.vector,
  integer,
  text,
  text,
  double precision
);

create function public.match_contents(
  query_embedding extensions.vector(384),
  match_count integer default 10,
  filter_content_type text default null,
  filter_series_type text default null,
  min_similarity double precision default 0
)
returns table (
  id bigint,
  external_id text,
  source text,
  title text,
  original_title text,
  content_type text,
  series_type text,
  overview text,
  genres jsonb,
  themes jsonb,
  moods jsonb,
  keywords jsonb,
  poster_url text,
  backdrop_url text,
  original_language varchar,
  country jsonb,
  release_year integer,
  director jsonb,
  "cast" jsonb,
  characters jsonb,
  rating_average numeric,
  rating_count integer,
  popularity_score numeric,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.external_id,
    c.source,
    c.title,
    c.original_title,
    c.content_type,
    c.series_type,
    c.overview,
    c.genres,
    c.themes,
    c.moods,
    c.keywords,
    c.poster_url,
    c.backdrop_url,
    c.original_language,
    c.country,
    c.release_year,
    c.director,
    c."cast",
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', ch.name,
          'description', ch.description,
          'role', cc.role,
          'actor_name', cc.actor_name,
          'voice_actor', cc.voice_actor
        ) order by cc.importance_score desc, ch.name
      )
      from public.content_characters cc
      join public.characters ch on ch.id = cc.character_id
      where cc.content_id = c.id
    ), c.characters, '[]'::jsonb),
    c.rating_average,
    c.rating_count,
    c.popularity_score,
    1 - (c.embedding operator(extensions.<=>) query_embedding)
  from public.contents c
  where c.is_active = true
    and c.embedding is not null
    and c.embedding_status = 'ready'
    and (filter_content_type is null or c.content_type = filter_content_type)
    and (filter_series_type is null or c.series_type = filter_series_type)
    and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= coalesce(min_similarity, 0)
  order by c.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(coalesce(match_count, 10), 1), 100);
$$;

comment on function public.match_contents(
  extensions.vector, integer, text, text, double precision
) is 'RLS-aware cosine retrieval over ready contents embeddings with metadata and character context for semantic search and RAG.';

revoke execute on function public.mark_contents_embedding_pending() from public, anon, authenticated;
revoke execute on function public.match_contents(
  extensions.vector, integer, text, text, double precision
) from public;
grant execute on function public.match_contents(
  extensions.vector, integer, text, text, double precision
) to anon, authenticated, service_role;

commit;
