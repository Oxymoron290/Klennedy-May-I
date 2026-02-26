# Copilot Instructions

## Project Overview

"May I" is a Klennedy/Clenney family variant of Continental Rummy, built as an Electron + Phaser 3 card game. The game uses dynamic deck counts (2 + ceil(players/2)), deals 11 cards per player, and progresses through 7 rounds with escalating meld requirements (sets and runs). Full rules are in `GameRules.md` (source of truth for all game logic).

## Build & Run

```sh
npm install
npm run dev          # Starts Express server + Electron app (concurrently)
npm run dev:web      # Starts Express server + Vite dev server (browser-only, no Electron)
npm run server       # Server only (Express + Socket.IO on port 3001)
npm run build        # electron-vite production build
```

The server runs with `ts-node-esm` from the `server/` directory. There are no test or lint scripts configured.

## Architecture

### Three-Process Electron App

- **Main process** (`src/main/index.ts`) — Electron BrowserWindow setup, loads renderer via Vite dev URL or built files.
- **Preload** (`src/preload/index.ts`) — `contextBridge` placeholder, `contextIsolation: true`.
- **Renderer** (`src/renderer/`) — Phaser 3 game. Entry point is `src/renderer/src/main.ts`, which boots a single `GameScene`.

### Shared Types (`shared/types.ts`)

Common types used by both client and server: `Card`, `Meld`, `MeldCard`, `PlayerInfo`, `Rank`, `roundConfigs`, `values`, and typed Socket.IO event interfaces (`ClientToServerEvents`, `ServerToClientEvents`).

### GameState Interface Pattern

The core architecture uses a `GameState` interface (`src/renderer/src/models/GameState.ts`) with two implementations:

- **`LocalGameState`** — Full client-side game logic for single-player with AI bots. Handles all rules: May I voting, meld validation (ace wrapping, same-suit restriction), round 7 no-discard, stock pile depletion, incorrect hand tracking.
- **`MultiplayerGameState`** — Socket.IO client that emits actions to the server and updates local state from server events.

The `GameScene` interacts only through the `GameState` interface and registers callbacks via `on*` event methods (e.g., `onTurnAdvance`, `onMayIRequest`, `onMeldSubmitted`). New game features should follow this event-driven callback pattern.

### Server (`server/index.ts`)

Express + Socket.IO server on port 3001 with a `ServerGame` class — an authoritative game engine that mirrors `LocalGameState` logic. Handles room management, validates all client actions, and broadcasts state. Imports types from `shared/types.ts`.

### AI Bots

`src/renderer/src/models/AIPlayer.ts` defines an abstract `AIPlayer` base class with concrete bot difficulty levels: `EasyBot`, `HardBot`, `ExpertBot`, `TimBot`. Bots wire into `LocalGameState` events and respond on their turns automatically. Each bot overrides `takeTurn()`, `considerRequestingMayI()`, and `considerMayIRequest()`.

### Debug Inspector

`src/renderer/debug.html` is a standalone HTML page that imports models directly via Vite and provides a non-Phaser UI for stepping through game state, inspecting hands, and testing May I voting. Access it at the `/debug.html` path during `dev:web`.

## Key Conventions

- **Card identity**: Every `Card` has a `guid` (UUID v4) for identity — always compare cards by `guid`, never by suit+rank (there are duplicate cards across multiple decks).
- **Round configs**: The 7-round meld requirements are in `shared/types.ts` (`roundConfigs`), also re-exported from `src/renderer/src/models/Types.ts`.
- **Meld validation**: Sets require exactly `InitialSetCount` (3) cards, runs require exactly `InitialRunCount` (4) cards when initially going down. Aces can be high, low, or wrapping in runs. No two runs may share the same suit. Use `validateMeld(meld, initial)` from `Player.ts`.
- **May I voting**: Voters respond in clockwise order from the current-turn player. If any voter denies, that voter takes the card + penalty. May I requests have a 15s timeout and can be cancelled. Players who pick out of turn cannot play cards until their next regular turn.
- **Round 7**: "All played, no throw away" — players must go out with all cards as melds, no discard.
- **Player flags**: `IPlayer.isPlayer` means "this is the local human's instance" (for the renderer). `IPlayer.isHuman` distinguishes human from AI.
- **Card assets**: Sprite atlas at `src/renderer/public/playingCards.png` + `.xml`. Frame naming: `card{Suit}{Rank}.png` (e.g., `cardHearts7.png`, `cardSpadesA.png`).
- **Scoring**: Cards 2-9 = 5 pts, 10-K = 10 pts, Ace = 15 pts (defined in `values` map in Types.ts and shared/types.ts).
- **TypeScript**: Strict mode enabled. `noUnusedLocals` and `noUnusedParameters` are on.
