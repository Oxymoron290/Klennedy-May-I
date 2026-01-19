import { Card } from "./Types";
import { IPlayer, Meld } from "./Player";

export interface MayIRequest {
  id: string;
  player: IPlayer;
  card: Card;
  responses: MayIResponse[];
  resolved: boolean;

  resolve?: (accepted: boolean) => void;
  promise?: Promise<boolean>;
  
  voters: IPlayer[];            // ordered voters (in order they must respond)
  nextVoterIndex: number;      // who is expected to respond next
  winner: IPlayer | null;       // who ended up taking the card
  deniedBy: IPlayer | null;     // if someone denied, who
  penaltyCard: Card | null;    // the penalty card for the winner (hidden by UI for others)

  turnPlayer: IPlayer;      // who was the turn player when this was requested
}

export interface MayIResponse {
  player: IPlayer;
  accepted: boolean;
}

type OpponentDraw = (player: IPlayer) => void;
type OpponentDiscard = (player: IPlayer, card: Card) => void;
type TurnAdvance = (player: IPlayer) => void;

export interface GameState {
  players: IPlayer[];
  drawPile: Card[];
  discardPile: Card[];
  currentTurn: number;
  currentRound: number;
  turnCount: number;
  roundMelds: Meld[];
  
  mayIRequests: MayIRequest[];

  cardOnTable: Card | null;
  drawnThisTurn: boolean;
  discardedThisTurn: boolean;

  // State Queries
  getCurrentPlayer(): IPlayer | undefined;
  getCurrentPlayerHand(): Card[];
  isPlayerTurn(player?: IPlayer): boolean;
  getRoundMelds(): Meld[];
  isPlayerDown(player?: IPlayer): boolean;
  getOpponents(): IPlayer[];

  // Player Controls
  startGame(): void;
  drawCard(): Card | null;
  drawDiscard(): Card | null;
  discard(card: Card): void;
  mayI(player: IPlayer, card: Card): Promise<boolean>;
  respondToMayI(player: IPlayer, request: MayIRequest, allow: boolean): void
  waitForNoPendingMayI(): Promise<void>;
  submitMelds(melds: Meld[]): boolean;
  addToMeld(meld: Meld, cards: Card[]): boolean;
  discardCardOnTable(): void;
  takeCardOnTable(index?: number): void;
  endTurn(): void;
  

  // Game Events
  onGameStart(callback: () => void): void;
  onGameEnd(callback: () => void): void;
  onRoundStart(callback: () => void): void;
  onRoundEnd(callback: () => void): void;
  onTurnAdvance(callback: TurnAdvance): void;
  onOpponentDraw(callback: OpponentDraw): void;
  onOpponentDiscard(callback: OpponentDiscard): void;
  onOpponentDrawFromDiscard(callback: (player: IPlayer, card: Card) => void): void;
  onMayIRequest(callback: (request: MayIRequest) => void): void;
  onMayIResponse(callback: (request: MayIRequest, response: MayIResponse) => void): void;
  onMayIResolved(callback: (request: MayIRequest, accepted: boolean) => void): void;
  onMayINextVoter(callback: (request: MayIRequest, nextVoter: IPlayer) => void): void;
  onMeldSubmitted(callback: (melds: Meld[]) => void): void;
  onMeldAppended(callback: (meld: Meld, cards: Card[]) => void): void;

}