# Copilot Instructions — May I? Card Game

## Build & Run

```bash
npm run dev          # Start server + Electron app (full stack)
npm run dev:web      # Start server + Vite renderer only (no Electron window)
npm run server       # Server only (Express + Socket.io on port 3001)
npm run build        # Production build via electron-vite
```

There are no tests or linters configured.

## Architecture

This is an **Electron + Phaser 3** card game with an **Express/Socket.io** server. The game implements "May I?", a Continental Rummy variant using 3 standard decks (156 cards), dealing 11 cards per player across 7 rounds.

### Two game modes via a shared interface

`GameState` (in `src/renderer/src/models/GameState.ts`) is the central interface. It has two implementations:

- **`LocalGameState`** — Fully functional single-player mode with AI opponents. All game logic runs client-side. This is the primary implementation.
- **`MultiplayerGameState`** — Socket.io-backed multiplayer. Mostly stubbed out (`throw new Error('Method not implemented.')`). The server (`server/index.ts`) also has minimal logic.

The Phaser scene (`src/renderer/src/scenes/Game.ts`) consumes `GameState` and doesn't know which implementation it's using.

### Event-driven game state

Game state changes are communicated through registered callbacks, not direct method returns:

```typescript
gameState.onTurnAdvance(player => { /* update UI */ });
gameState.onMayIRequest(request => { /* show voting UI */ });
gameState.onMayIResolved(request => { /* animate result */ });
```

### AI system

`AIPlayer` is an abstract class in `src/renderer/src/models/AIPlayer.ts`. Concrete bots (`EasyBot`, `HardBot`, `ExpertBot`, `TimBot`) wire into the same event callbacks and call `GameState` methods to play. AI bots only work with `LocalGameState`.

### Debug inspector

`src/renderer/debug.html` is a standalone HTML page that instantiates `LocalGameState` directly with all-AI players. It renders game state as DOM elements (no Phaser). Useful for testing game logic changes without the full UI. Access it via `npm run dev:web` and navigating to `/debug.html`.

## Key Domain Concepts

- **Round configs** (`roundConfigs` in `Types.ts`): Each of the 7 rounds requires a specific combination of sets and runs to "go down" (meld). Round 1 = 2 sets, Round 7 = 3 runs.
- **"May I" requests**: When it's not your turn, you can request the top discard. This triggers a **voting chain** — players between the current turn and the requester vote in order. If denied, the denier takes the card instead. The winner also draws a penalty card.
- **"Going down"**: Submitting the required melds for the current round. Once down, a player can append cards to any existing meld.
- **Cards are identified by `guid`** (UUID), not suit+rank, because the game uses 3 decks with duplicate cards.
- **Sets** require exactly 3 cards of the same rank (initial). **Runs** require exactly 4 consecutive cards of the same suit (initial). See `InitialSetCount` and `InitialRunCount` in `Types.ts`.

## Conventions

- **TypeScript with strict mode**, ESM modules throughout. The root `tsconfig.json` covers both `src/` and `server/`.
- **`uuid` (v4)** is used for all entity IDs (cards, players, meld IDs, May I request IDs).
- Card suits are typed as `'spades' | 'hearts' | 'diamonds' | 'clubs'`. Ranks are `1-13` where 1=Ace, 11=Jack, 12=Queen, 13=King.
- Card point values: Ace and King = 15, 8–Queen = 10, 2–7 = 5 (defined in `values` map in `Types.ts`).
- `IPlayer.isPlayer` means "this is the human playing on this client instance" (not a generic boolean). `isHuman` distinguishes human vs AI.
- The server has a **duplicate** of game types and logic in both `server/index.ts` and `server/gameLogic.ts` — the canonical game logic lives in the renderer models.
