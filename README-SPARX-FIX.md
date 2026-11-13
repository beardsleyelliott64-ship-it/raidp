# Sparx panel fix

The panels previously timed out because `validAccount()` waited on Supabase before acknowledging the Discord button. The bot now acknowledges the interaction immediately and handles database errors cleanly.

The current Render log also shows Supabase itself is missing `public.accounts`: `Could not find the table 'public.accounts' in the schema cache`.

## One-time Supabase setup
1. Open your Supabase project.
2. Open SQL Editor.
3. Paste/run `supabase-setup.sql`.
4. Restart/redeploy the bot.

## Discord permissions
Normal commands are public by default now. Sensitive admin commands remain protected. You can also set `ADMIN_ROLE_IDS=role1,role2` in Render.
