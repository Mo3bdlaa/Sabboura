-- Sabboura schema. Run once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Drive items: folders and boards, arranged in a tree via parent_id.
-- ---------------------------------------------------------------------------
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id   uuid references public.items (id) on delete cascade,
  kind        text not null check (kind in ('folder', 'board')),
  name        text not null default 'Untitled',
  starred     boolean not null default false,
  trashed_at  timestamptz,
  thumbnail   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists items_owner_idx on public.items (owner_id);
create index if not exists items_parent_idx on public.items (parent_id);

-- ---------------------------------------------------------------------------
-- Board contents (Excalidraw scene). Kept apart from items so listing the
-- drive never downloads full scenes.
-- ---------------------------------------------------------------------------
create table if not exists public.board_scenes (
  board_id    uuid primary key references public.items (id) on delete cascade,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  elements    jsonb not null default '[]'::jsonb,
  app_state   jsonb not null default '{}'::jsonb,
  files       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Saving merges instead of overwriting: for each element id the copy with the
-- highest version wins (ties → lowest versionNonce, matching Excalidraw's own
-- reconcile rule). Two devices saving at once can never clobber each other.
-- Deleted elements are kept as tombstones for a day, then pruned.
-- ---------------------------------------------------------------------------
create or replace function public.save_board_elements(
  p_board_id uuid,
  p_elements jsonb,
  p_app_state jsonb
) returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.board_scenes (board_id) values (p_board_id)
  on conflict (board_id) do nothing;

  update public.board_scenes s
  set
    elements = (
      select coalesce(jsonb_agg(m.e order by m.e->>'index' collate "C"), '[]'::jsonb)
      from (
        select distinct on (x.e->>'id') x.e
        from (
          select e from jsonb_array_elements(s.elements) e
          union all
          select e from jsonb_array_elements(p_elements) e
        ) x
        order by
          x.e->>'id',
          coalesce((x.e->>'version')::bigint, 0) desc,
          coalesce((x.e->>'versionNonce')::bigint, 0) asc
      ) m
      where not (
        coalesce((m.e->>'isDeleted')::boolean, false)
        and coalesce((m.e->>'updated')::bigint, 0) < (extract(epoch from now()) * 1000)::bigint - 86400000
      )
    ),
    app_state = p_app_state,
    updated_at = now()
  where s.board_id = p_board_id;
$$;

-- ---------------------------------------------------------------------------
-- Row level security: every row belongs to exactly one user.
-- ---------------------------------------------------------------------------
alter table public.items enable row level security;
alter table public.board_scenes enable row level security;

drop policy if exists "items: owner full access" on public.items;
create policy "items: owner full access" on public.items
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "scenes: owner full access" on public.board_scenes;
create policy "scenes: owner full access" on public.board_scenes
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.items i where i.id = board_id and i.owner_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- 1) Postgres changes on items → the drive updates live across devices.
-- 2) Private broadcast/presence channels named "board:<uuid>" → only the
--    board's owner may join them.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;
end $$;

drop policy if exists "board channels: owner can receive" on realtime.messages;
create policy "board channels: owner can receive" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'board:%'
    and exists (
      select 1 from public.items i
      where i.id::text = split_part(realtime.topic(), ':', 2)
        and i.owner_id = (select auth.uid())
    )
  );

drop policy if exists "board channels: owner can send" on realtime.messages;
create policy "board channels: owner can send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() like 'board:%'
    and exists (
      select 1 from public.items i
      where i.id::text = split_part(realtime.topic(), ':', 2)
        and i.owner_id = (select auth.uid())
    )
  );
