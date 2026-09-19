-- ProofRecall Day 6: let one search mean "either of these"
-- Source of truth for the schema. Executed in the Supabase SQL Editor on 2026-09-19.
--
-- What changed, in one line: tier 1 parses the query with
-- 'websearch_to_tsquery' instead of 'plainto_tsquery'.
--
-- Why it matters for the product, not just for SQL:
--   A prospect says "it's too expensive". The customer quote that answers it
--   says "pricing", and a second one says "procurement approved it". With
--   'plainto_tsquery' a chip cannot ask for both at once, because that function
--   ANDs every lexeme it is given — "security or procurement" was read as
--   "find a quote containing security AND or AND procurement", which returns
--   nothing, so the trigram tier picked up the pieces and returned one row by
--   accident. That forced every objection chip to carry exactly one word, which
--   made the row of chips look arbitrary to a user: why is "Security will never
--   approve it" wired to the word 'security' and not to the sentence?
--
-- Measured on the live database before writing this (SQL Editor, 2026-09-19):
--   plainto('roi')                 = 'roi'            websearch('roi')                = 'roi'
--   plainto('pricing roi')         = 'price' & 'roi'  websearch('pricing roi')        = 'price' & 'roi'
--   plainto('pricing or roi')      = 'price' & 'roi'  websearch('pricing or roi')     = 'price' | 'roi'
--   websearch('"in half"')         = 'half'           (quoted phrases become phrases)
-- So: single words behave identically, multiple bare words are still ANDed, and
-- the only behaviour that changes is a query that contains an explicit 'or' —
-- which under the old function could only ever return less, never more.
-- 'scripts/qa/day6.mjs' asserts the identical-single-word property against the
-- live function instead of trusting this comment.
--
-- Two things this deliberately does NOT do:
--   * It does not search tags. 'search_text' is built from the quote alone, so a
--     word has to be something a customer wrote. Changing that is a product
--     decision about ranking, not a syntax fix.
--   * It does not touch tier 2 (trigram) or the newest-first browse path. Both
--     stay as Day 2/3 wrote them.
--
-- Side effect worth naming: the tsquery is now parsed once per call into 'v_ts'
-- instead of three times per row (select-list rank, WHERE, ORDER BY). That is a
-- smaller win than the semantics and it is the only reason this migration is
-- longer than one line.
--

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
  -- Parsed once, reused by the WHERE and both rank expressions. Empty when the
  -- query is only stop words ("the", "a"); the tiers below treat that as "no
  -- full-text signal" and fall through exactly as they used to.
  v_ts tsquery := case
    when nullif(trim(coalesce(query, '')), '') is null then null
    else websearch_to_tsquery('english', trim(query))
  end;
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

  -- Tier 1: full-text search. 'or', quoted phrases and '-exclusion' all work
  -- here now; whitespace-separated words still mean "and".
  if numnode(coalesce(v_ts, ''::tsquery)) > 0 then
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
      ts_rank(t.search_text, v_ts)::double precision,
      'fts'::text
    from public.testimonials t
    where t.search_text @@ v_ts
      and (
        tag_name is null
        or exists (
          select 1 from public.testimonial_tags tt
          join public.tags g on g.id = tt.tag_id
          where tt.testimonial_id = t.id and g.name = lower(trim(tag_name))
        )
      )
    order by ts_rank(t.search_text, v_ts) desc,
             t.created_at desc
    limit v_limit;

    if found then
      return;
    end if;
  end if;

  -- Tier 2: trigram word-similarity (typos and partial phrases), unchanged from
  -- 0002 except that it now also catches a query made of stop words only.
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

-- Same signature, so the existing EXECUTE grant survives a replace — re-issued
-- anyway because this project has 'auto-expose' off and an explicit grant is the
-- convention every migration here follows.
grant execute on function public.search_testimonials(text, text, integer) to anon, authenticated;
