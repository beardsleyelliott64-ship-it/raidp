-- Run once in Supabase SQL Editor
-- Answer cache for Sparx Maths autocompleter

create table if not exists public.sparx_maths (
  id bigserial primary key,
  content jsonb,
  answer jsonb,
  incorrect_answers jsonb,
  ai_model text,
  created_at timestamptz not null default now()
);

create index if not exists sparx_maths_content_idx on public.sparx_maths using gin (content);

-- Optional RPC used by the bot (safe no-ops if you prefer direct table access only)
create or replace function public.get_sparx_answer(table_name text, search_content jsonb)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  if table_name = 'sparx_maths' then
    select to_jsonb(t) into result from public.sparx_maths t
      where t.content = search_content
      order by id desc limit 1;
  elsif table_name = 'sparx_reader' then
    select to_jsonb(t) into result from public.sparx_reader t
      where t.question::text = search_content::text
      order by created_at desc limit 1;
  end if;
  return result;
end;
$$;

create or replace function public.update_sparx_answer(
  table_name text,
  search_content jsonb,
  new_answer jsonb default null,
  new_incorrect_answers jsonb default null,
  new_ai_model text default null
)
returns void
language plpgsql
as $$
begin
  if table_name = 'sparx_maths' then
    update public.sparx_maths
      set
        answer = coalesce(new_answer, answer),
        incorrect_answers = coalesce(new_incorrect_answers, incorrect_answers),
        ai_model = coalesce(new_ai_model, ai_model)
      where content = search_content;
  end if;
end;
$$;
