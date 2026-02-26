# Copilot Instructions

## Project Overview

"May I" is a Klennedy/Clenney family variant of Continental Rummy, built as an Electron + Phaser 3 card game. The game uses 3 standard 52-card decks, deals 11 cards per player, and progresses through 7 rounds with escalating meld requirements (sets and runs). Full rules are in `GameRules.md`.

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

### GameState Interface Pattern

The core architecture uses a `GameState` interface (`src/renderer/src/models/GameState.ts`) with two implementations:

- **`LocalGameState`** (`src/renderer/src/models/LocalGameState.ts`) — Full client-side game logic for single-player with AI bots. This is the primary, most complete implementation.
- **`MultiplayerGameState`** (`src/renderer/src/models/MultiplayerGameState.ts`) — Socket.IO-based stub that delegates to the Express server. Many methods throw `'Method not implemented.'`.

The `GameScene` interacts only through the `GameState` interface and registers callbacks via `on*` event methods (e.g., `onTurnAdvance`, `onMayIRequest`, `onMeldSubmitted`). New game features should follow this event-driven callback pattern.

### Server (`server/`)

A separate Express + Socket.IO server (`server/index.ts`) on port 3001. Has its own `tsconfig.json`. The server-side game logic is a **duplicate** of the client-side types and functions (duplicated `Card`, `GameState`, `shuffleDeck`, `roundConfigs`). The server is skeletal — socket handlers exist for `joinRoom`, `mayI`, and `playMeld` but are mostly stubs.

### AI Bots

`src/renderer/src/models/AIPlayer.ts` defines an abstract `AIPlayer` base class with concrete bot difficulty levels: `EasyBot`, `HardBot`, `ExpertBot`, `TimBot`. Bots wire into `LocalGameState` events and respond on their turns automatically. Each bot overrides `takeTurn()`, `considerRequestingMayI()`, and `considerMayIRequest()`.

### Debug Inspector

`src/renderer/debug.html` is a standalone HTML page that imports models directly via Vite and provides a non-Phaser UI for stepping through game state, inspecting hands, and testing May I voting. Access it at the `/debug.html` path during `dev:web`.

## Key Conventions

- **Card identity**: Every `Card` has a `guid` (UUID v4) for identity — always compare cards by `guid`, never by suit+rank (there are duplicate cards across the 3 decks).
- **Round configs**: The 7-round meld requirements are defined as `roundConfigs` in `src/renderer/src/models/Types.ts`. This same array is duplicated in `server/index.ts` and `server/gameLogic.ts`.
- **Meld validation**: Sets require exactly `InitialSetCount` (3) cards, runs require exactly `InitialRunCount` (4) cards when initially going down. Use `validateMeld(meld, initial)` from `Player.ts`.
- **May I voting**: When a player requests "May I", voters respond in clockwise order starting from the current turn player. If any voter denies, that voter takes the card + penalty instead. The system uses a Promise-based resolution (`waitForMayIResolution`).
- **Player flags**: `IPlayer.isPlayer` means "this is the local human's instance" (for the renderer). `IPlayer.isHuman` distinguishes human from AI.
- **Card assets**: Sprite atlas at `src/renderer/public/playingCards.png` + `.xml`. Frame naming: `card{Suit}{Rank}.png` (e.g., `cardHearts7.png`, `cardSpadesA.png`).
- **Scoring**: Cards 2-9 = 5 pts, 10-K = 10 pts, Ace = 15 pts (defined in `Types.ts` `values` map).
- **TypeScript**: Strict mode enabled. `noUnusedLocals` and `noUnusedParameters` are on.
