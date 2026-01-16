
export interface Card { suit: string; rank: number }
export interface GameState {
  deck: Card[]
  players: { id: string; hand: Card[]; melds: Card[][] }[]
  discard: Card[]
  currentTurn: string
  round: number  // 1-7 configs
}

const roundConfigs = [
  { sets: 2, },
  { runs: 1, sets: 1 },
  { runs: 2, },
  { sets: 3, },
  { runs: 1, sets: 2 },
  { runs: 2, sets: 1 },
  { runs: 3, },
]

export function shuffleDeck(): Card[] {
  /* Fisher-Yates */
  const suits = ['hearts', 'diamonds', 'clubs', 'spades']
  const ranks = Array.from({ length: 13 }, (_, i) => i + 1)
  const deck: Card[] = []
  const deckCount = 3  // Number of decks to use
  for(var i = 0; i < deckCount; i++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank })
      }
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function isValidMeld(meld: Card[], config: any): boolean {
  console.log(roundConfigs);
  console.log(config);
  console.log(meld);
  /* Sets/runs logic */
  
  return false;
}

export function initGame(roomId: string): GameState {
  console.log(`Initializing game for room ${roomId}`);
  /* Deal 10 cards */
  return {
    deck: shuffleDeck(),
    players: [],
    discard: [],
    currentTurn: '',
    round: 1
  };
}
