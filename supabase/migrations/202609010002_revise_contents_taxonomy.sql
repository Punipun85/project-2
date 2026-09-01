-- EntertainmentAI contents taxonomy revision.
-- Safely upgrades the original unified catalog without deleting existing rows.

begin;

-- The original RPC depends on the enum that is replaced by a more extensible
-- text taxonomy in this revision.
drop function if exists public.match_contents(
  extensions.vector,
  integer,
  public.content_type,
  double precision
);

alter table public.contents
  add column if not exists series_type text,
  add column if not exists keywords jsonb not null default '[]'::jsonb,
  add column if not exists status text,
  add column if not exists number_of_seasons integer,
  add column if not exists episode_duration_minutes integer,
  add column if not exists creator jsonb not null default '[]'::jsonb,
  add column if not exists platform text,
  add column if not exists tmdb_rating numeric(4, 2);

-- Preserve the old episodic count while adopting the revised column name.
alter table public.contents
  rename column episodes to number_of_episodes;

-- Capture detailed classifications before replacing the old enum values.
update public.contents
set series_type = case content_type::text
  when 'kdrama' then 'kdrama'
  when 'tv_series' then 'tv_series'
  else series_type
end
where series_type is null;

alter table public.contents
  alter column content_type type text
  using (
    case content_type::text
      when 'kdrama' then 'series'
      when 'tv_series' then 'series'
      else content_type::text
    end
  );

drop type if exists public.content_type;

-- Backfill revised fields from equivalent legacy metadata.
update public.contents
set
  series_type = case
    when title = 'Attack on Titan' and content_type = 'anime' then 'anime_series'
    else series_type
  end,
  number_of_seasons = coalesce(
    number_of_seasons,
    case when content_type in ('series', 'anime') then season_number end
  ),
  episode_duration_minutes = coalesce(
    episode_duration_minutes,
    case when content_type in ('series', 'anime') then duration_minutes end
  ),
  keywords = case
    when keywords = '[]'::jsonb then ai_tags
    else keywords
  end,
  platform = coalesce(
    platform,
    case when network in ('Netflix', 'Disney+', 'Prime Video', 'HBO', 'Max') then network end
  ),
  tmdb_rating = coalesce(
    tmdb_rating,
    case when source = 'TMDB' then rating_average end
  );

alter table public.contents
  drop constraint if exists contents_episodes_nonnegative,
  drop constraint if exists contents_content_type_allowed,
  drop constraint if exists contents_series_type_allowed,
  drop constraint if exists contents_status_allowed,
  drop constraint if exists contents_classification_consistent,
  drop constraint if exists contents_number_of_seasons_nonnegative,
  drop constraint if exists contents_number_of_episodes_nonnegative,
  drop constraint if exists contents_episode_duration_positive,
  drop constraint if exists contents_keywords_array,
  drop constraint if exists contents_creator_array,
  drop constraint if exists contents_tmdb_rating_range;

alter table public.contents
  add constraint contents_content_type_allowed check (
    content_type in ('movie', 'series', 'anime', 'documentary', 'special')
  ),
  add constraint contents_series_type_allowed check (
    series_type is null or series_type in (
      'tv_series',
      'streaming_series',
      'kdrama',
      'jdrama',
      'cdrama',
      'web_series',
      'mini_series',
      'limited_series',
      'anime_series',
      'anime_movie',
      'ova'
    )
  ),
  add constraint contents_status_allowed check (
    status is null or status in ('ongoing', 'completed', 'cancelled', 'upcoming')
  ),
  add constraint contents_classification_consistent check (
    series_type is null
    or (content_type = 'anime' and series_type in ('anime_series', 'anime_movie', 'ova'))
    or (
      content_type = 'series'
      and series_type in (
        'tv_series',
        'streaming_series',
        'kdrama',
        'jdrama',
        'cdrama',
        'web_series',
        'mini_series',
        'limited_series'
      )
    )
  ),
  add constraint contents_number_of_seasons_nonnegative check (
    number_of_seasons is null or number_of_seasons >= 0
  ),
  add constraint contents_number_of_episodes_nonnegative check (
    number_of_episodes is null or number_of_episodes >= 0
  ),
  add constraint contents_episode_duration_positive check (
    episode_duration_minutes is null or episode_duration_minutes > 0
  ),
  add constraint contents_keywords_array check (jsonb_typeof(keywords) = 'array'),
  add constraint contents_creator_array check (jsonb_typeof(creator) = 'array'),
  add constraint contents_tmdb_rating_range check (
    tmdb_rating is null or tmdb_rating between 0 and 10
  );

comment on table public.contents is
  'Unified EntertainmentAI catalog for movies, series, anime, documentaries, and special content used by recommendation, semantic search, and RAG.';
comment on column public.contents.content_type is
  'Main category: movie, series, anime, documentary, or special.';
comment on column public.contents.series_type is
  'Optional detailed series or anime classification such as kdrama, streaming_series, anime_series, or ova.';
comment on column public.contents.keywords is
  'JSON array of normalized provider or editorial keywords used by search, recommendation, and retrieval.';
comment on column public.contents.status is
  'Lifecycle status: ongoing, completed, cancelled, or upcoming.';
comment on column public.contents.number_of_seasons is
  'Total known number of seasons for episodic content.';
comment on column public.contents.number_of_episodes is
  'Total known number of episodes for episodic content.';
comment on column public.contents.episode_duration_minutes is
  'Typical episode runtime in minutes.';
comment on column public.contents.duration_minutes is
  'Total runtime in minutes for movie, documentary, special, or other non-episodic content.';
comment on column public.contents.season_number is
  'Specific season represented by a provider record when applicable.';
comment on column public.contents.creator is
  'JSON array of creator, showrunner, writer, or original-author objects.';
comment on column public.contents.platform is
  'Primary streaming platform such as Netflix, Disney+, Prime Video, HBO, or Max.';
comment on column public.contents.tmdb_rating is
  'TMDB rating on a 0 to 10 scale when available.';

create index if not exists contents_series_type_idx
  on public.contents (series_type)
  where series_type is not null;
create index if not exists contents_keywords_gin_idx
  on public.contents using gin (keywords jsonb_path_ops);

-- Rebuild weighted full-text search so keywords participate in retrieval.
drop index if exists public.contents_search_document_idx;
alter table public.contents drop column if exists search_document;
alter table public.contents
  add column search_document tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(overview, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, genres::text), 'B') ||
    setweight(to_tsvector('simple'::regconfig, themes::text), 'B') ||
    setweight(to_tsvector('simple'::regconfig, keywords::text), 'B')
  ) stored;

comment on column public.contents.search_document is
  'Stored weighted full-text vector generated from title, overview, genres, themes, and keywords.';

create index contents_search_document_idx
  on public.contents using gin (search_document);

-- RLS-aware cosine retrieval for semantic search and chatbot RAG. Both main
-- and detailed classifications can be filtered independently.
create or replace function public.match_contents(
  query_embedding extensions.vector(384),
  match_count integer default 10,
  filter_content_type text default null,
  filter_series_type text default null,
  min_similarity double precision default 0
)
returns table (
  id bigint,
  title text,
  content_type text,
  series_type text,
  overview text,
  poster_url text,
  rating_average numeric,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.title,
    c.content_type,
    c.series_type,
    c.overview,
    c.poster_url,
    c.rating_average,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.contents as c
  where c.embedding is not null
    and (filter_content_type is null or c.content_type = filter_content_type)
    and (filter_series_type is null or c.series_type = filter_series_type)
    and 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) >= coalesce(min_similarity, 0)
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(greatest(coalesce(match_count, 10), 1), 100);
$$;

comment on function public.match_contents(
  extensions.vector,
  integer,
  text,
  text,
  double precision
) is 'RLS-aware cosine similarity retrieval for EntertainmentAI semantic search, recommendation, and RAG.';

-- Admin status is controlled by a trusted app_metadata JWT claim. Supabase
-- users cannot edit their own app_metadata.
create or replace function public.is_catalog_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

comment on function public.is_catalog_admin() is
  'Returns true when the current Supabase JWT contains app_metadata.role = admin.';

alter table public.contents enable row level security;

drop policy if exists contents_public_read_active on public.contents;
drop policy if exists contents_anon_read_active on public.contents;
drop policy if exists contents_authenticated_read on public.contents;
drop policy if exists contents_admin_write on public.contents;

create policy contents_anon_read_active
on public.contents
for select
to anon
using (is_active = true);

create policy contents_authenticated_read
on public.contents
for select
to authenticated
using (true);

create policy contents_admin_write
on public.contents
for all
to authenticated
using ((select public.is_catalog_admin()))
with check ((select public.is_catalog_admin()));

comment on policy contents_anon_read_active on public.contents is
  'Anonymous clients can read active catalog rows only.';
comment on policy contents_authenticated_read on public.contents is
  'Authenticated clients can read the full catalog, including inactive rows.';
comment on policy contents_admin_write on public.contents is
  'Only authenticated users with app_metadata.role = admin can insert, update, or delete catalog rows.';

grant select on table public.contents to anon;
grant select, insert, update, delete on table public.contents to authenticated;
grant all on table public.contents to service_role;
grant usage, select on sequence public.contents_id_seq to authenticated, service_role;

revoke execute on function public.is_catalog_admin() from public, anon;
grant execute on function public.is_catalog_admin() to authenticated, service_role;
revoke execute on function public.match_contents(
  extensions.vector,
  integer,
  text,
  text,
  double precision
) from public;
grant execute on function public.match_contents(
  extensions.vector,
  integer,
  text,
  text,
  double precision
) to anon, authenticated, service_role;

-- Revised, idempotent examples. Embeddings remain null until generated by the
-- configured 384-dimensional sentence-transformer pipeline.
insert into public.contents (
  external_id,
  source,
  content_type,
  series_type,
  title,
  original_title,
  alternative_titles,
  overview,
  tagline,
  ai_summary,
  genres,
  themes,
  moods,
  keywords,
  original_language,
  country,
  poster_url,
  backdrop_url,
  trailer_url,
  release_date,
  release_year,
  status,
  duration_minutes,
  number_of_seasons,
  number_of_episodes,
  episode_duration_minutes,
  season_number,
  studio,
  network,
  platform,
  director,
  creator,
  "cast",
  characters,
  rating_average,
  rating_count,
  tmdb_rating,
  imdb_rating,
  mal_rating,
  popularity_score,
  ai_tags
)
values
  (
    '157336', 'TMDB', 'movie', null, 'Interstellar', 'Interstellar',
    '["Interstellar"]'::jsonb,
    'A team of explorers travels through a wormhole in space to find a new home for humanity.',
    'Mankind was born on Earth. It was never meant to die here.',
    'An emotional science-fiction epic about family, time, survival, and humanity crossing the stars.',
    '["Adventure", "Drama", "Sci-Fi"]'::jsonb,
    '["space exploration", "time dilation", "family", "human survival"]'::jsonb,
    '["emotional", "epic", "thought-provoking", "hopeful"]'::jsonb,
    '["wormhole", "hard sci-fi", "father-daughter", "space"]'::jsonb,
    'en', '["United States", "United Kingdom"]'::jsonb,
    'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    'https://image.tmdb.org/t/p/original/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg',
    'https://www.youtube.com/watch?v=zSWdZVtXT7E',
    '2014-11-05', 2014, 'completed', 169, null, null, null, null,
    '[{"name": "Legendary Pictures"}, {"name": "Syncopy"}]'::jsonb,
    null, null,
    '[{"name": "Christopher Nolan", "role": "Director"}]'::jsonb,
    '[{"name": "Christopher Nolan", "role": "Writer"}, {"name": "Jonathan Nolan", "role": "Writer"}]'::jsonb,
    '[{"name": "Matthew McConaughey", "character": "Cooper"}, {"name": "Anne Hathaway", "character": "Brand"}]'::jsonb,
    '[{"name": "Cooper", "performer": "Matthew McConaughey"}, {"name": "Brand", "performer": "Anne Hathaway"}]'::jsonb,
    8.70, 2300000, 8.70, 8.70, null, 98.4000,
    '["wormhole", "hard sci-fi", "father-daughter", "space"]'::jsonb
  ),
  (
    '16498', 'JIKAN', 'anime', 'anime_series', 'Attack on Titan', 'Shingeki no Kyojin',
    '["Attack on Titan", "Shingeki no Kyojin", "AoT", "進撃の巨人"]'::jsonb,
    'Humanity fights for survival behind enormous walls while young soldiers uncover the truth about the Titans.',
    null,
    'A dark war fantasy about survival, freedom, inherited conflict, and the cost of breaking cycles of violence.',
    '["Action", "Drama", "Fantasy", "Suspense"]'::jsonb,
    '["war", "survival", "freedom", "revenge"]'::jsonb,
    '["dark", "emotional", "intense", "tragic"]'::jsonb,
    '["titans", "military", "mystery", "manga adaptation"]'::jsonb,
    'ja', '["Japan"]'::jsonb,
    'https://cdn.myanimelist.net/images/anime/10/47347l.jpg', null, null,
    '2013-04-07', 2013, 'completed', null, 4, 87, 24, 1,
    '[{"name": "Wit Studio"}, {"name": "MAPPA"}]'::jsonb,
    'MBS', null,
    '[{"name": "Tetsuro Araki", "role": "Director"}]'::jsonb,
    '[{"name": "Hajime Isayama", "role": "Original Creator"}]'::jsonb,
    '[{"name": "Yuki Kaji", "character": "Eren Yeager"}, {"name": "Yui Ishikawa", "character": "Mikasa Ackerman"}]'::jsonb,
    '[{"name": "Eren Yeager", "voice_actor": "Yuki Kaji"}, {"name": "Mikasa Ackerman", "voice_actor": "Yui Ishikawa"}]'::jsonb,
    8.60, 3900000, null, null, 8.60, 99.1000,
    '["titans", "military", "mystery", "manga adaptation"]'::jsonb
  ),
  (
    '126485', 'TMDB', 'series', 'kdrama', 'Moving', '무빙',
    '["Moving", "무빙"]'::jsonb,
    'Children with hidden superpowers and their parents face a dangerous secret connected to their shared past.',
    null,
    'A multigenerational Korean superhero drama grounded in family, sacrifice, first love, and hidden identity.',
    '["Action", "Drama", "Fantasy", "Mystery"]'::jsonb,
    '["family", "sacrifice", "coming of age", "hidden identity"]'::jsonb,
    '["emotional", "suspenseful", "heartwarming", "intense"]'::jsonb,
    '["superpowers", "parents", "high school", "webtoon adaptation"]'::jsonb,
    'ko', '["South Korea"]'::jsonb,
    null, null, null, '2023-08-09', 2023, 'completed', null, 1, 20, 50, 1,
    '[{"name": "Studio&NEW"}, {"name": "Mr. Romance"}]'::jsonb,
    null, 'Disney+',
    '[{"name": "Park In-je", "role": "Director"}]'::jsonb,
    '[{"name": "Kang Full", "role": "Creator and Writer"}]'::jsonb,
    '[{"name": "Ryu Seung-ryong", "character": "Jang Ju-won"}, {"name": "Han Hyo-joo", "character": "Lee Mi-hyun"}]'::jsonb,
    '[{"name": "Jang Ju-won", "performer": "Ryu Seung-ryong"}, {"name": "Lee Mi-hyun", "performer": "Han Hyo-joo"}]'::jsonb,
    8.50, 45000, 8.50, 8.40, null, 92.3000,
    '["superpowers", "parents", "high school", "webtoon adaptation"]'::jsonb
  ),
  (
    '66732', 'TMDB', 'series', 'streaming_series', 'Stranger Things', 'Stranger Things',
    '["Stranger Things"]'::jsonb,
    'When a young boy vanishes, a small town uncovers secret experiments, terrifying supernatural forces, and one strange girl.',
    null,
    'A nostalgic supernatural mystery about friendship, family, and confronting a hidden world.',
    '["Drama", "Mystery", "Sci-Fi", "Fantasy"]'::jsonb,
    '["friendship", "government experiments", "parallel dimension", "coming of age"]'::jsonb,
    '["suspenseful", "nostalgic", "dark", "adventurous"]'::jsonb,
    '["small town", "supernatural", "missing child", "1980s"]'::jsonb,
    'en', '["United States"]'::jsonb,
    null, null, null, '2016-07-15', 2016, 'ongoing', null, 5, 42, 50, 1,
    '[{"name": "21 Laps Entertainment"}]'::jsonb,
    null, 'Netflix',
    '[{"name": "The Duffer Brothers", "role": "Director"}]'::jsonb,
    '[{"name": "Matt Duffer", "role": "Creator"}, {"name": "Ross Duffer", "role": "Creator"}]'::jsonb,
    '[{"name": "Winona Ryder", "character": "Joyce Byers"}, {"name": "David Harbour", "character": "Jim Hopper"}]'::jsonb,
    '[]'::jsonb,
    8.60, 19000, 8.60, 8.70, null, 96.0000,
    '["small town", "supernatural", "missing child", "1980s"]'::jsonb
  ),
  (
    '87108', 'TMDB', 'series', 'limited_series', 'Chernobyl', 'Chernobyl',
    '["Chernobyl"]'::jsonb,
    'The people who faced the 1986 nuclear disaster struggle to contain its catastrophic consequences.',
    'What is the cost of lies?',
    'A historical limited series about institutional failure, sacrifice, truth, and the human cost of catastrophe.',
    '["Drama", "History", "Thriller"]'::jsonb,
    '["nuclear disaster", "truth", "sacrifice", "institutional failure"]'::jsonb,
    '["dark", "tense", "tragic", "thought-provoking"]'::jsonb,
    '["historical", "Soviet Union", "radiation", "disaster"]'::jsonb,
    'en', '["United States", "United Kingdom"]'::jsonb,
    null, null, null, '2019-05-06', 2019, 'completed', null, 1, 5, 65, 1,
    '[{"name": "Sister Pictures"}, {"name": "The Mighty Mint"}]'::jsonb,
    'HBO', 'HBO',
    '[{"name": "Johan Renck", "role": "Director"}]'::jsonb,
    '[{"name": "Craig Mazin", "role": "Creator and Writer"}]'::jsonb,
    '[{"name": "Jared Harris", "character": "Valery Legasov"}, {"name": "Stellan Skarsgård", "character": "Boris Shcherbina"}]'::jsonb,
    '[]'::jsonb,
    9.10, 10000, 9.10, 9.30, null, 94.0000,
    '["historical", "Soviet Union", "radiation", "disaster"]'::jsonb
  )
on conflict (source, external_id) do update
set
  content_type = excluded.content_type,
  series_type = excluded.series_type,
  title = excluded.title,
  original_title = excluded.original_title,
  alternative_titles = excluded.alternative_titles,
  overview = excluded.overview,
  tagline = excluded.tagline,
  ai_summary = excluded.ai_summary,
  genres = excluded.genres,
  themes = excluded.themes,
  moods = excluded.moods,
  keywords = excluded.keywords,
  original_language = excluded.original_language,
  country = excluded.country,
  poster_url = excluded.poster_url,
  backdrop_url = excluded.backdrop_url,
  trailer_url = excluded.trailer_url,
  release_date = excluded.release_date,
  release_year = excluded.release_year,
  status = excluded.status,
  duration_minutes = excluded.duration_minutes,
  number_of_seasons = excluded.number_of_seasons,
  number_of_episodes = excluded.number_of_episodes,
  episode_duration_minutes = excluded.episode_duration_minutes,
  season_number = excluded.season_number,
  studio = excluded.studio,
  network = excluded.network,
  platform = excluded.platform,
  director = excluded.director,
  creator = excluded.creator,
  "cast" = excluded."cast",
  characters = excluded.characters,
  rating_average = excluded.rating_average,
  rating_count = excluded.rating_count,
  tmdb_rating = excluded.tmdb_rating,
  imdb_rating = excluded.imdb_rating,
  mal_rating = excluded.mal_rating,
  popularity_score = excluded.popularity_score,
  ai_tags = excluded.ai_tags,
  is_active = true;

commit;
