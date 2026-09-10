-- NexaPlay external embedding service integration.
-- Keeps the existing 384-dimensional catalog vectors and changes the terminal
-- lifecycle state from `ready` to the requested `completed` value.

begin;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

alter table public.contents
  add column if not exists embedding extensions.vector(384),
  add column if not exists embedding_status text not null default 'pending',
  add column if not exists embedded_at timestamptz,
  add column if not exists embedding_error text;

alter table public.contents
  drop constraint if exists contents_embedding_status_allowed;

update public.contents
set embedding_status = 'completed'
where embedding is not null
  and embedding_status in ('ready', 'processing', 'pending');

update public.contents
set embedding_status = 'pending'
where embedding is null
  and embedding_status = 'ready';

alter table public.contents
  add constraint contents_embedding_status_allowed check (
    embedding_status in ('pending', 'processing', 'completed', 'failed')
  );

comment on column public.contents.embedding_status is
  'External embedding lifecycle state: pending, processing, completed, or failed.';

create index if not exists contents_embedding_hnsw_idx
  on public.contents using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

drop function if exists public.match_contents(
  extensions.vector, integer, text, text, double precision
);

create function public.match_contents(
  query_embedding extensions.vector(384),
  match_threshold double precision default 0.2,
  match_count integer default 10,
  filter_content_type text default null,
  filter_series_type text default null
)
returns table (
  content_id bigint,
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
    and c.embedding_status = 'completed'
    and (filter_content_type is null or c.content_type = filter_content_type)
    and (filter_series_type is null or c.series_type = filter_series_type)
    and 1 - (c.embedding operator(extensions.<=>) query_embedding)
      >= least(greatest(coalesce(match_threshold, 0.2), -1), 1)
  order by c.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(coalesce(match_count, 10), 1), 100);
$$;

comment on function public.match_contents(
  extensions.vector, double precision, integer, text, text
) is 'Cosine similarity retrieval over externally generated completed embeddings for semantic search and RAG.';

revoke execute on function public.match_contents(
  extensions.vector, double precision, integer, text, text
) from public;
grant execute on function public.match_contents(
  extensions.vector, double precision, integer, text, text
) to anon, authenticated, service_role;

commit;
