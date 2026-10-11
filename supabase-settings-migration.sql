-- EAM settings migration
alter table public.accounts
  add column if not exists sparx_maths_settings jsonb not null default '{"pdfSettings":{"question":false,"working_out":false},"min":100,"max":140,"model":"No Models"}'::jsonb,
  add column if not exists sparx_reader_settings jsonb not null default '{"srp":0,"wpm":300,"min":10,"max":20}'::jsonb,
  add column if not exists sparx_science_settings jsonb not null default '{"min":20,"max":40,"model":"No Models"}'::jsonb,
  add column if not exists languagenut_settings jsonb not null default '{"min":10,"max":30,"accuracy":100}'::jsonb,
  add column if not exists seneca_settings jsonb not null default '{"min":23,"max":25}'::jsonb;

create or replace function public.set_column_to_default(table_name text, column_name text)
returns void language plpgsql as $$
begin
  execute format('update %I set %I = default', table_name, column_name);
end;
$$;
