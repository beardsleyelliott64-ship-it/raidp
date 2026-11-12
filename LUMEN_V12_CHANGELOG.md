# Lumen v12 — Discord Dashboard Customizer

## Changes
- Reworked Gemini custom feature generation from text-only responses to validated declarative interactive feature definitions.
- Added a Discord interaction runtime for feature state, rendering, buttons, and state transitions.
- Added safe operations for assignment, counters, toggles, random values, array operations, standard card-deck creation/shuffling/drawing, summation, and nested conditions.
- Generated features are persisted and appear on the existing `/dashboard` Discord message; feature sessions are ephemeral.
- Added owner checks to launch and operate generated features.
- Preserved support for existing saved text-only custom buttons.
- Added runtime tests alongside the existing reader parser tests.

## Explicitly not included
No Blackjack button, command, built-in game, game-specific logic, or economy feature is installed. Any feature is created only when the owner requests it through **Customize Dashboard**.

## Validation
- `node --check` on the changed runtime, customizer, and interaction router.
- `npm test` passes both the existing Reader AI parser tests and new interactive dashboard runtime tests.

## Runtime notes
Generated definitions use a safe, constrained action language rather than executing arbitrary model-produced source code. This supports a broad class of interactive tools and games. A feature requiring integrations or operations outside the runtime's supported primitives must be extended deliberately rather than pretending a text response performs that work.
