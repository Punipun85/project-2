-- NexaPlay Batch 4: additive negative-feedback signal for premium content actions.

begin;

alter table public.user_interactions
  drop constraint if exists user_interactions_type_allowed;

alter table public.user_interactions
  add constraint user_interactions_type_allowed check (
    interaction_type in (
      'view', 'click', 'like', 'watchlist', 'complete', 'rating',
      'search', 'chat', 'not_interested'
    )
  );

comment on column public.user_interactions.interaction_type is
  'Behavior signal: view, click, like, watchlist, complete, rating, search, chat, or not_interested.';

commit;
