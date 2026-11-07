-- EAM / Sparx Reader answer cache
-- Run this in the Supabase SQL Editor.

create table if not exists public.sparx_reader (
    discord_id text not null,
    question_hash text not null,
    question text,
    answer text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (discord_id, question_hash)
);

create index if not exists sparx_reader_discord_id_idx
    on public.sparx_reader(discord_id);

-- Keep updated_at current when an existing cached answer is changed.
create or replace function public.update_sparx_reader_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists sparx_reader_updated_at on public.sparx_reader;

create trigger sparx_reader_updated_at
before update on public.sparx_reader
for each row
execute function public.update_sparx_reader_updated_at();

-- Optional: enable Row Level Security.
-- The bot uses the Supabase service key/server-side credentials, so no
-- client-side policy is required for the bot.
alter table public.sparx_reader enable row level security;
