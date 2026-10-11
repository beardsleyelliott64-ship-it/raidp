-- Run once in Supabase Dashboard -> SQL Editor
-- Stores Sparx Maths bookwork codes per package for PDF / check recovery

create table if not exists public.bookworks (
  package_id text primary key,
  bookworks text not null default '{}',
  timestamp timestamptz
);

create index if not exists bookworks_package_id_idx on public.bookworks(package_id);
