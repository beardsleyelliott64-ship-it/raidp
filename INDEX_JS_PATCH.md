# index.js patch — two additions required

## 1. Add lumen modal handler (inside the `isModalSubmit` listener)

Find this block near the top of the modal handler (around line 383):

```js
if (interaction.customId.startsWith('autocompleterModule_')) {
```

**Add BEFORE it:**

```js
if (interaction.customId.startsWith('lumen_')) {
    await require('./handlers/readerBookmarkletFlow.js').handleModalSubmit(interaction);
    return;
}
```

---

## 2. Add lumen component handler (inside the `isMessageComponent` / button+select handler)

The existing bot handles buttons via per-message collectors on the start embed channel
messages. The `/dashboard` command creates its own collector, so **no global change is
needed for buttons**.

However if you have a global `interactionCreate` listener that also catches
`isButton` / `isStringSelectMenu` and might swallow lumen_ IDs before the
collector fires, add an early exit there:

```js
if (interaction.customId.startsWith('lumen_')) return; // handled by dashboard collector
```

---

## 3. Environment variable

Add to `.env` (and to `render.yaml` → `envVars`):

```
BOT_PUBLIC_URL=https://YOUR-SERVICE.onrender.com
```

Render also exposes `RENDER_EXTERNAL_URL` automatically — the bot uses that
as a fallback so this is optional if you're on Render.
