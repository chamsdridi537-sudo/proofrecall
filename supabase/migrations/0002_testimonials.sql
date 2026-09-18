-- ProofRecall Day 3: testimonial library + tags + retrieval
-- Source of truth for the schema. Executed in the Supabase SQL Editor on 2026-09-18.
--
-- This project was created with "Automatically expose new tables" DISABLED, so
-- every table here needs explicit grants to anon/authenticated, or PostgREST
-- returns a permission error instead of an empty result set.
--
-- NOTE: keep every statement free of `--` comments and on ONE line when pasting
-- into the dashboard SQL Editor — Monaco auto-indents multi-line input and
-- appends at the cursor instead of replacing it. Use exactly one fill per empty
-- tab, then run.
--
-- NOTE: the dashboard runs a whole batch inside ONE transaction. A verification
-- `raise exception '...'` at the end of a DO block therefore rolls the entire
-- batch back — the editor still prints your message, so the change looks applied
-- while the database is unchanged. Use `raise notice` for verification output
-- and confirm applied changes out of band (e.g. through PostgREST).

-- 0. Idempotent guards (these trigger the dashboard's "Potential issue" prompt)
drop function if exists public.search_testimonials(text, text, integer);
drop table if exists public.testimonial_tags;
drop table if exists public.tags;
drop table if exists public.testimonials;

-- 1. Extensions
create extension if not exists moddatetime;
create extension if not exists pg_trgm;

-- 2. Testimonials: the quote is the product, so it carries its own search index
create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  quote text not null,
  author text,
  author_role text,
  author_company text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(quote, '') || ' ' ||
      coalesce(author, '') || ' ' ||
      coalesce(author_role, '') || ' ' ||
      coalesce(author_company, '') || ' ' ||
      coalesce(source, '')
    )
  ) stored
);

-- 3. Tags: per-user, never global. A shared tag table would leak which
--    companies get praised across tenants. Names are normalised on write
--    (lower + trim) so a plain unique index is enough.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  created_at timestamptz not null default now()
);

create unique index tags_user_name_key on public.tags (user_id, name);

create table public.testimonial_tags (
  testimonial_id uuid not null references public.testimonials(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (testimonial_id, tag_id)
);

-- 4. Indexes: one per retrieval path
--    FTS  -> GIN over the generated tsvector
--    typo -> GIN trigram over the raw quote
--    browse/filter -> newest first per owner
create index testimonials_search_idx on public.testimonials using gin (search_text);
create index testimonials_quote_trgm_idx on public.testimonials using gin (quote gin_trgm_ops);
create index testimonials_user_created_idx on public.testimonials (user_id, created_at desc);
create index tags_user_idx on public.tags (user_id);

-- 5. Keep updated_at honest
create trigger testimonials_set_updated_at
  before update on public.testimonials
  for each row execute function moddatetime(updated_at);

-- 6. RLS: deny by default, owner-only on all three tables
alter table public.testimonials enable row level security;
alter table public.tags enable row level security;
alter table public.testimonial_tags enable row level security;

create policy "testimonials_select_own"
  on public.testimonials for select
  to authenticated
  using (auth.uid() = user_id);

create policy "testimonials_insert_own"
  on public.testimonials for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "testimonials_update_own"
  on public.testimonials for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "testimonials_delete_own"
  on public.testimonials for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "tags_select_own"
  on public.tags for select
  to authenticated
  using (auth.uid() = user_id);

create policy "tags_insert_own"
  on public.tags for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "tags_delete_own"
  on public.tags for delete
  to authenticated
  using (auth.uid() = user_id);

-- Join table is writable only through its owner's rows; RLS on both sides is
-- what actually protects it (a row here is meaningless without the parent).
create policy "testimonial_tags_select_own"
  on public.testimonial_tags for select
  to authenticated
  using (
    exists (
      select 1 from public.testimonials t
      where t.id = testimonial_id and t.user_id = auth.uid()
    )
    and exists (
      select 1 from public.tags g
      where g.id = tag_id and g.user_id = auth.uid()
    )
  );

create policy "testimonial_tags_insert_own"
  on public.testimonial_tags for insert
  to authenticated
  with check (
    exists (
      select 1 from public.testimonials t
      where t.id = testimonial_id and t.user_id = auth.uid()
    )
    and exists (
      select 1 from public.tags g
      where g.id = tag_id and g.user_id = auth.uid()
    )
  );

create policy "testimonial_tags_delete_own"
  on public.testimonial_tags for delete
  to authenticated
  using (
    exists (
      select 1 from public.testimonials t
      where t.id = testimonial_id and t.user_id = auth.uid()
    )
  );

-- 7. Retrieval. SECURITY INVOKER (the default) is the whole point: the
--    function runs as the calling user, so RLS filters every tier. Ranking is
--    ts_rank then recency; if full text finds nothing we fall back to trigram
--    word-similarity so a typo like "prcing" still surfaces the quote.
--    Tier 2 compares word_similarity(query, quote) against an explicit 0.4
--    cutoff instead of using the `quote <% query` operator. Reason, measured on
--    this database: pg_trgm.word_similarity_threshold reports source "default"
--    with setting 0.6, and word_similarity('prcing', the pricing quote) is only
--    0.571 — so the operator form silently returned zero rows. The threshold
--    cannot be pinned per function ("permission denied to set parameter": the
--    dashboard role is not a true superuser), so the tier must not depend on it.
--    0.4 sits between the measured noise floor (0.22-0.33 for words that occur
--    nowhere in the library) and the typo signal (0.5-1.0).
--    Trade-off: an expression comparison cannot use testimonials_quote_trgm_idx,
--    so the fallback tier scans the caller's own rows only (RLS already prunes
--    every other user's rows, and quotes are capped at 2000 characters). If a
--    library ever grows large enough for that to hurt, lower the GUC at the role
--    or database level and switch the predicate back to the index-usable
--    `quote <% query` operator form.
create or replace function public.search_testimonials(
  query text,
  tag_name text default null,
  result_limit integer default 25
)
returns table (
  id uuid,
  quote text,
  author text,
  author_role text,
  author_company text,
  source text,
  created_at timestamptz,
  tags text[],
  rank double precision,
  match_kind text
)
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
declare
  v_q text := nullif(trim(coalesce(query, '')), '');
  v_limit int := least(greatest(coalesce(result_limit, 25), 1), 50);
begin
  -- No query: browse, newest first (still owner-scoped by RLS).
  if v_q is null then
    return query
    select
      t.id,
      t.quote,
      t.author,
      t.author_role,
      t.author_company,
      t.source,
      t.created_at,
      (
        select array_agg(g.name order by g.name)
        from public.testimonial_tags tt
        join public.tags g on g.id = tt.tag_id
        where tt.testimonial_id = t.id
      ),
      null::double precision,
      'recent'::text
    from public.testimonials t
    where (
      tag_name is null
      or exists (
        select 1 from public.testimonial_tags tt
        join public.tags g on g.id = tt.tag_id
        where tt.testimonial_id = t.id and g.name = lower(trim(tag_name))
      )
    )
    order by t.created_at desc
    limit v_limit;
    return;
  end if;

  -- Tier 1: full-text search.
  return query
  select
    t.id,
    t.quote,
    t.author,
    t.author_role,
    t.author_company,
    t.source,
    t.created_at,
    (
      select array_agg(g.name order by g.name)
      from public.testimonial_tags tt
      join public.tags g on g.id = tt.tag_id
      where tt.testimonial_id = t.id
    ),
    ts_rank(t.search_text, plainto_tsquery('english', v_q))::double precision,
    'fts'::text
  from public.testimonials t
  where t.search_text @@ plainto_tsquery('english', v_q)
    and (
      tag_name is null
      or exists (
        select 1 from public.testimonial_tags tt
        join public.tags g on g.id = tt.tag_id
        where tt.testimonial_id = t.id and g.name = lower(trim(tag_name))
      )
    )
  order by ts_rank(t.search_text, plainto_tsquery('english', v_q)) desc,
           t.created_at desc
  limit v_limit;

  if found then
    return;
  end if;

  -- Tier 2: trigram word-similarity (typos and partial phrases).
  return query
  select
    t.id,
    t.quote,
    t.author,
    t.author_role,
    t.author_company,
    t.source,
    t.created_at,
    (
      select array_agg(g.name order by g.name)
      from public.testimonial_tags tt
      join public.tags g on g.id = tt.tag_id
      where tt.testimonial_id = t.id
    ),
    word_similarity(v_q, t.quote)::double precision,
    'trigram'::text
  from public.testimonials t
  where word_similarity(v_q, t.quote) >= 0.4
    and (
      tag_name is null
      or exists (
        select 1 from public.testimonial_tags tt
        join public.tags g on g.id = tt.tag_id
        where tt.testimonial_id = t.id and g.name = lower(trim(tag_name))
      )
    )
  order by word_similarity(v_q, t.quote) desc, t.created_at desc
  limit v_limit;
end;
$fn$;

-- 8. Explicit grants (auto-expose is off on this project)
grant usage on schema public to anon, authenticated;
grant select on public.testimonials to anon, authenticated;
grant select, insert, update, delete on public.testimonials to authenticated;
grant select on public.tags to anon, authenticated;
grant select, insert, delete on public.tags to authenticated;
grant select on public.testimonial_tags to anon, authenticated;
grant select, insert, delete on public.testimonial_tags to authenticated;
grant execute on function public.search_testimonials(text, text, integer) to anon, authenticated;
