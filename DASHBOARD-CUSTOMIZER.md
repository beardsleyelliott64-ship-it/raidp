# Lumen Discord Dashboard Customizer

The customizer edits the **Discord dashboard opened with `/dashboard`**. The web dashboard remains separate and is preserved.

## Dashboard layout

- **Main dashboard:** existing Lumen controls are retained.
- **Custom Features:** owner-published interactive features appear as public buttons. Each member gets a private feature session when they open one.
- **Custom People Requests:** members can submit feature suggestions. Requests are stored separately from published features and are rate-limited to three per member per hour.

The public dashboard shows a disabled `Coming Soon` placeholder where the owner-only control would otherwise appear. When the owner runs `/dashboard`, Lumen also sends a private owner panel with `Customize Dashboard` and `Manage Feature Requests`. All owner operations check the configured owner ID server-side.

## Feature generation and publication

The owner selects a button colour, names the feature, and describes its behaviour. Gemini is tried in the configured V12 fallback order. Its response is validated as a declarative feature definition; model-generated JavaScript is never executed.

The owner receives a preview summary and must explicitly choose **Publish Feature**. Publication creates a guild slash command (`/lumen-<feature>-<id>`) and persists the feature definition. The slash command and dashboard button launch the same supported interactive runtime. The original dashboard message is edited in place when its saved message reference is still available.

Discord only offers four standard button styles (Primary, Secondary, Success, Danger). The ten requested colour labels are mapped to those supported styles; they are not arbitrary RGB button colours.

## Supported feature runtime

Views are text displays with `{{stateKey}}` and `{{sum:arrayKey}}` interpolation. Supported state operations are `set`, `increment`, `decrement`, `toggle`, `random_int`, `append`, `remove_last`, `create_deck`, `shuffle`, `draw`, `push`, `clear`, `sum`, and nested `if` conditions. Limits are enforced on view rows, actions, state keys, action steps and text lengths.

The runtime is intentionally bounded. It cannot run arbitrary JavaScript, shell commands, private filesystem operations or arbitrary network requests. If a request needs unsupported capabilities, it must be redesigned around supported operations rather than pretending to implement it.

## Persistence and configuration

- `data/dashboard-customizations.json`: published feature definitions and command names.
- `data/dashboard-feature-requests.json`: member suggestions and review status.
- `data/dashboard-message.json`: guild, channel and message IDs for the public dashboard.
- `GEMINI_API_KEY`: Gemini API key; never commit the key.
- `JAILBREAK_OWNER_ID`: owner ID; defaults to the project owner ID.
- `GUILD_ID`: guild used for command registration; defaults to the specified Lumen guild.

The Discord bot must have permission to manage application commands in the target guild. On startup, persisted custom commands are included in command synchronisation. Existing guild commands are merged so unrelated commands are not intentionally removed.

## Progress-bar emojis

The shared progress renderer uses the exact server emoji names `bar_left_empty`, `bar_left_half`, `bar_left_full`, `bar_empty`, `bar_half`, `bar_fill`, `bar_right_empty`, `bar_right_half`, and `bar_right_full`. The existing startup emoji loader resolves these names from the target guild. If an emoji is missing, the renderer uses a visible Unicode fallback.

## Known limitations in this build

- The generation progress display does not yet provide the full staged live progress and estimated-time-remaining interface from the V12 specification.
- Request review currently supports approve/reject status changes; approved requests are not yet automatically piped into the generator and preview workflow.
- The owner preview is a summary of the validated definition, not a fully rendered interactive sandbox preview.
- Member feature requests are stored and reviewed, but there is no automatic notification/DM workflow for request status changes.
- Live Discord command registration and interactions require valid bot credentials and were not testable in this offline build environment.
