-- EAM/Sparx account database setup
-- Run this once in Supabase Dashboard -> SQL Editor.
-- The bot uses SUPABASEKEY server-side, so this table can remain private/RLS-protected.

create table if not exists public.accounts (
  discord_id text primary key,
  master_password text,
  license text,
  slots integer not null default 0,
  custom_slots boolean not null default false,
  uses jsonb not null default '{}'::jsonb,
  main_accounts jsonb not null default '{}'::jsonb,
  total_usage jsonb not null default '{}'::jsonb,
  free_trial_start timestamptz,
  saved_accounts text
);

create index if not exists accounts_discord_id_idx on public.accounts(discord_id);
