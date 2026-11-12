# Lumen Discord Dashboard Customizer

The customizer changes the **Discord bot dashboard opened with `/dashboard`**. It does not add features to the public website.

## Interactive feature generation

The owner chooses a button colour, names the feature and describes its behaviour. Gemini compiles that description into a validated declarative feature definition (`initialState`, `view`, and `actions`). The bot stores the definition in `data/dashboard-customizations.json`; clicking the generated dashboard button opens an ephemeral interactive Discord message. Its buttons execute the generated state transitions and update that message.

The runtime deliberately does not execute model-generated JavaScript, shell commands, or arbitrary code. It supports text views with state interpolation (`{{key}}`, `{{sum:key}}`) and the following safe state operations: `set`, `increment`, `decrement`, `toggle`, `random_int`, `append`, `remove_last`, `create_deck`, `shuffle`, `draw`, `push`, `clear`, `sum`, and nested `if` conditions. Definitions are size- and schema-validated before saving. Generated actions and feature launch are owner-only.

This is a generic feature system: no game, game-specific command, dashboard button, or economy is installed by default. A game or utility exists only if the owner explicitly requests it through Customize Dashboard. Legacy text-only custom buttons remain readable; newly generated buttons use the interactive runtime.

## Configuration

Set `GEMINI_API_KEY` and `JAILBREAK_OWNER_ID` in the bot environment. The default owner ID is retained from the existing project if the environment variable is not set.
