# Lumen Dashboard Customizer

The Discord `/dashboard` command now posts a public Components V2 dashboard. The owner-only `Customize Dashboard` interaction opens a private colour picker and modal, asks Gemini to turn the request into a polished, Discord-formatted button response, then adds the new button to the exact dashboard message that started the flow. It does not require running `/dashboard` again.

## Configuration

Set `GEMINI_API_KEY` in the bot's environment. `JAILBREAK_OWNER_ID` defaults to `1363240484818128926` and can be overridden in the environment.

Gemini is tried in this order, automatically moving to the next model on an error, timeout, invalid JSON, or empty response:

1. `gemini-2.0-flash-lite`
2. `gemini-2.0-flash`
3. `gemini-2.5-flash-lite`
4. `gemini-2.5-flash`
5. `gemini-2.5-pro`
6. `gemini-3-flash-preview`
7. `gemini-3-pro-preview`
8. `gemini-3.1-flash-lite-preview`
9. `gemini-3.1-pro-preview`

## Saved buttons

Generated button definitions are stored in `data/dashboard-customizations.json` and survive restarts. Up to 25 custom buttons are supported. Button colours map to Discord's supported button styles: blue/primary, grey/secondary, green/success, and red/danger.

## Security and Discord UI limitation

Only the configured owner can open the customizer, submit the form, or activate generated custom buttons. Every interaction is checked against Discord's authenticated interaction user ID; button visibility is never treated as authorization.

Discord uses one shared component state for a public message. It cannot render the same public button as enabled for one viewer and disabled/grey for another. This implementation keeps `/dashboard` public and persistent, so the `Customize Dashboard` button is visible to everyone; non-owner clicks are rejected ephemerally. Making it grey and disabled only for non-owners would require per-user ephemeral dashboards, which would no longer be a shared public dashboard.

Gemini output is treated as data and rendered as a response; generated JavaScript is never evaluated or executed. This avoids letting an AI response write arbitrary code into the running bot. Requests requiring new integrations, privileged operations, or additional backend capabilities need a reviewed code change rather than automatic execution.
