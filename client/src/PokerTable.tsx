import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomSnapshot, RoomEvent, PlayerSeat } from './types';
import { ThreePokerTableScene, type SeatVisual } from './ThreePokerTableScene';

interface PokerTableProps {
  snapshot: RoomSnapshot;
  events: RoomEvent[];
}

type HandStage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

type WinningHand = {
  playerId?: string;
  displayName: string;
  cards: string[];
  amountWon?: number;
  description?: string;
};

interface PokerGameState {
  pot: number;
  currentBet: number;
  communityCards: string[];
  currentPlayer?: string;
  lastAction?: string;
  playerActions: Map<string, { action: string; timestamp: string }>;
  stage?: HandStage;
  winningHands: WinningHand[];
  playerCards: Map<string, string[]>;
  buttonSeat?: number;
  seats: Map<number, PlayerSeat>;
}

const suitSymbol: Record<string, { symbol: string; className: string }> = {
  H: { symbol: "♥", className: "suit-red" },
  D: { symbol: "♦", className: "suit-red" },
  S: { symbol: "♠", className: "suit-black" },
  C: { symbol: "♣", className: "suit-black" },
};

const formatCard = (
  raw: string,
): { label: string; suit: string; className: string; rank: string } => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { label: raw, suit: "", className: "", rank: "" };
  }

  const suitKey = trimmed.slice(-1).toUpperCase();
  const rankRaw = trimmed.slice(0, -1).toUpperCase() || trimmed;
  const rank = rankRaw === "T" ? "10" : rankRaw;
  const suit = suitSymbol[suitKey] ?? { symbol: suitKey, className: "" };

  return {
    label: `${rank}${suit.symbol}`,
    suit: suit.symbol,
    className: suit.className,
    rank,
  };
};

const renderCard = (
  card: string,
  key: string,
  options: { small?: boolean; delay?: number } = {},
) => {
  const formatted = formatCard(card);
  const classNames = ['playing-card', formatted.className, 'card-enter'];
  if (options.small) {
    classNames.push('playing-card-small');
  }
  const style = options.delay !== undefined ? { animationDelay: `${options.delay}s` } : undefined;
  return (
    <div key={key} className={classNames.join(' ')} style={style}>
      <div className="corner tl">
        <span className="rank">{formatted.rank}</span>
        <span className="suit">{formatted.suit}</span>
      </div>
      <div className="pip">{formatted.suit}</div>
      <div className="corner br">
        <span className="rank">{formatted.rank}</span>
        <span className="suit">{formatted.suit}</span>
      </div>
    </div>
  );
};

const renderCardBack = (key: string, options: { small?: boolean; delay?: number } = {}) => {
  const classNames = ['playing-card', 'back', 'card-enter'];
  if (options.small) {
    classNames.push('playing-card-small');
  }
  const style = options.delay !== undefined ? { animationDelay: `${options.delay}s` } : undefined;
  return (
    <div key={key} className={classNames.join(' ')} style={style}>
      <div className="card-back-pattern" />
    </div>
  );
};

export const extractPokerState = (events: RoomEvent[], initialPlayers: PlayerSeat[] = []): PokerGameState => {
  const state: PokerGameState = {
    pot: 0,
    currentBet: 0,
    communityCards: [],
    lastAction: undefined,
    playerActions: new Map(),
    stage: 'preflop',
    winningHands: [],
    playerCards: new Map(),
    seats: new Map(initialPlayers.map((player) => [player.seatNumber, { ...player }])),
  };

  // Parcourir les events pour extraire l'état actuel
  for (const event of events) {
    if (event.payload) {
      if (event.payload.pot !== undefined) {
        state.pot = Number(event.payload.pot) || 0;
      }
      if (event.payload.currentBet !== undefined) {
        state.currentBet = Number(event.payload.currentBet) || 0;
      }
      if (event.payload.communityCards && Array.isArray(event.payload.communityCards)) {
        state.communityCards = (event.payload.communityCards as unknown[]).map((card) => String(card));
      }
      if (event.payload.playerName) {
        state.currentPlayer = String(event.payload.playerName);
      }
      if (event.payload.buttonSeat !== undefined) {
        const parsed = Number(event.payload.buttonSeat);
        if (Number.isFinite(parsed)) {
          state.buttonSeat = parsed;
        }
      }
    }

    // Extraire les actions des joueurs
    if (event.payload?.stage && typeof event.payload.stage === 'string') {
      const stageValue = event.payload.stage.toLowerCase();
      if (stageValue === 'preflop') {
        state.winningHands = [];
        state.playerCards.clear();
        state.communityCards = [];
      }
      if (['preflop', 'flop', 'turn', 'river', 'showdown'].includes(stageValue)) {
        state.stage = stageValue as HandStage;
      }
    }

    if (event.eventType === 'hand_started') {
      state.stage = 'preflop';
      state.winningHands = [];
      state.playerCards.clear();
      state.communityCards = [];
      state.playerActions.clear();
    }

    if (event.eventType === 'hand_completed') {
      const hands = event.payload?.winningHands;
      if (Array.isArray(hands)) {
        state.winningHands = hands.map((handRaw) => {
          const hand = handRaw as Record<string, unknown>;
          const playerId = typeof hand['playerId'] === 'string' ? (hand['playerId'] as string) : undefined;
          const displayName =
            typeof hand['displayName'] === 'string'
              ? (hand['displayName'] as string)
              : typeof playerId === 'string'
              ? playerId
              : 'Player';
          const cardsValue = Array.isArray(hand['cards']) ? (hand['cards'] as unknown[]) : [];
          const amountField = hand['amountWon'] ?? hand['amount'];
          return {
            playerId,
            displayName,
            cards: cardsValue.map((card) => String(card)),
            amountWon: typeof amountField === 'number' ? (amountField as number) : undefined,
            description: typeof hand['description'] === 'string' ? (hand['description'] as string) : undefined,
          };
        });
      }
      const showdownHands = event.payload?.showdownHands;
      if (Array.isArray(showdownHands)) {
        const entries: [string, string[]][] = showdownHands.map((handRaw) => {
          const hand = handRaw as Record<string, unknown>;
          const playerId = typeof hand['playerId'] === 'string' ? (hand['playerId'] as string) : undefined;
          const displayName =
            typeof hand['displayName'] === 'string'
              ? (hand['displayName'] as string)
              : typeof playerId === 'string'
              ? playerId
              : 'Player';
          const cards = Array.isArray(hand['cards'])
            ? (hand['cards'] as unknown[]).map((card) => String(card))
            : [];
          return [playerId ?? displayName, cards];
        });
        state.playerCards = new Map(entries);
      }
      state.stage = 'showdown';
    }

    if (event.eventType === 'action_taken' && event.payload?.playerName) {
      const playerName = String(event.payload.playerName);
      const actionMatch = event.message.match(/(fold|check|call|bet|raise|all-in)(?:\s+(\d+(?:\.\d+)?))?/i);
      if (actionMatch) {
        const action = actionMatch[1];
        const amount = actionMatch[2];
        state.playerActions.set(playerName, {
          action: amount ? `${action} ${amount}` : action,
          timestamp: event.timestamp,
        });
      }
      const seatNumber = typeof event.payload.seatNumber === 'number' ? event.payload.seatNumber : undefined;
      const playerStack = typeof event.payload.playerStack === 'number' ? Number(event.payload.playerStack) : undefined;
      if (seatNumber !== undefined) {
        const seatPlayer = state.seats.get(seatNumber);
        if (seatPlayer && playerStack !== undefined) {
          state.seats.set(seatNumber, { ...seatPlayer, stack: playerStack });
        }
      }
    }

    if (event.eventType === 'action_taken') {
      state.lastAction = event.message;
    }

    if (event.eventType === 'player_registered') {
      const seatNumber = typeof event.payload?.seatNumber === 'number' ? event.payload.seatNumber : undefined;
      if (seatNumber !== undefined) {
        state.seats.set(seatNumber, {
          playerId: String(event.payload?.playerId ?? `seat-${seatNumber}`),
          seatNumber,
          displayName: String(event.payload?.displayName ?? `Seat ${seatNumber}`),
          stack: Number(event.payload?.stack ?? 0),
        });
      }
    }

    if (event.eventType === 'player_busted') {
      const playerId = typeof event.payload?.playerId === 'string' ? event.payload.playerId : undefined;
      if (playerId) {
        for (const [seatNumber, seatPlayer] of state.seats.entries()) {
          if (seatPlayer.playerId === playerId) {
            state.seats.delete(seatNumber);
          }
        }
      }
    }
  }

  return state;
};

const formatAmount = (value: number): string => {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value < 1 ? 2 : 0,
    maximumFractionDigits: 4,
  });
};

const parseConfigNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const parseSeatCount = (value: unknown): number | undefined => {
  const parsed = parseConfigNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  return Math.round(parsed);
};

const buildSeatPositions = (count: number) => {
  const radius = 40;
  const offset = Math.PI / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count - offset;
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    return {
      top: `${y}%`,
      left: `${x}%`,
      transform: 'translate(-50%, -50%)',
    };
  });
};

export function PokerTable({ snapshot, events }: PokerTableProps) {
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const eventCountRef = useRef(events.length);

  useEffect(() => {
    const previousCount = eventCountRef.current;
    if (events.length === previousCount) {
      return;
    }
    eventCountRef.current = events.length;
    if (events.length === 0) {
      setTimelineIndex(0);
      setIsPlaying(false);
      return;
    }
    if (previousCount === 0) {
      setTimelineIndex(0);
    } else {
      setTimelineIndex((prev) => Math.min(prev, events.length - 1));
    }
    setIsPlaying(true);
  }, [events.length]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    if (timelineIndex >= events.length - 1) {
      setIsPlaying(false);
      return;
    }
    const handle = setTimeout(() => {
      setTimelineIndex((prev) => Math.min(prev + 1, events.length - 1));
    }, 1000);
    return () => clearTimeout(handle);
  }, [isPlaying, timelineIndex, events.length]);

  const visibleEvents = useMemo(() => events.slice(0, timelineIndex + 1), [events, timelineIndex]);
  const summaryPlayers = snapshot.summary?.players ?? [];
  const gameState = useMemo(
    () => extractPokerState(visibleEvents, summaryPlayers),
    [visibleEvents, summaryPlayers],
  );
  const currentEvent = visibleEvents.length > 0 ? visibleEvents[visibleEvents.length - 1] : undefined;
  const configuredMaxPlayers = parseSeatCount(snapshot.config.maxPlayers);
  const maxPlayers = Math.max(2, configuredMaxPlayers ?? 6);
  const seatPositions = useMemo(() => buildSeatPositions(maxPlayers), [maxPlayers]);
  const currentStage = gameState.stage ?? 'preflop';
  const winningPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const hand of gameState.winningHands) {
      if (hand.playerId) {
        ids.add(hand.playerId);
      }
    }
    return ids;
  }, [gameState.winningHands]);

  const seats: (PlayerSeat | null)[] = Array.from({ length: maxPlayers }, (_, index) => {
    const seatPlayer = gameState.seats.get(index);
    if (seatPlayer) {
      return seatPlayer;
    }
    return null;
  });

  const seatVisuals: SeatVisual[] = seats.map((player, seatNumber) => {
    const playerCards = player ? gameState.playerCards.get(player.playerId) ?? [] : [];
    const cards = player
      ? playerCards.length > 0
        ? playerCards
        : [undefined, undefined]
      : [];
    return {
      seatNumber,
      player,
      cards,
      stack: player?.stack ?? 0,
      isActive: Boolean(player && gameState.currentPlayer === player.displayName),
      isWinner: Boolean(player && winningPlayerIds.has(player.playerId)),
      isButton: gameState.buttonSeat === seatNumber,
    };
  });

  const showHoleCards = currentStage === 'showdown';

  return (
    <div className="poker-table-container">
      <div className="poker-table-stage">
        <div className="poker-table-viewport card">
          <ThreePokerTableScene
            seats={seatVisuals}
            communityCards={gameState.communityCards}
            pot={gameState.pot}
            stage={currentStage}
            showHoleCards={showHoleCards}
            maxPlayers={maxPlayers}
          />
          <div className="table-overlay-info">
            <div className="overlay-block">
              <span>Stage</span>
              <strong>{currentStage.toUpperCase()}</strong>
            </div>
            <div className="overlay-block">
              <span>Pot</span>
              <strong>{formatAmount(gameState.pot)}</strong>
            </div>
            <div className="overlay-block">
              <span>Current Bet</span>
              <strong>{formatAmount(gameState.currentBet)}</strong>
            </div>
          </div>
          <div className="seat-overlay-layer">
            {seatVisuals.map((seat) => {
              const playerAction = seat.player ? gameState.playerActions.get(seat.player.displayName) : undefined;
              const showAction =
                playerAction && Date.now() - new Date(playerAction.timestamp).getTime() < 10000;
              const seatStyle = seatPositions[seat.seatNumber] ?? {
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              };
              return (
                <div
                  key={`overlay-${seat.seatNumber}`}
                  className={`seat-overlay ${seat.player ? 'occupied' : 'empty'} ${
                    seat.isActive ? 'active' : ''
                  } ${seat.isWinner ? 'winner' : ''}`}
                  style={seatStyle}
                >
                  <div className="seat-name-row">
                    <span className="seat-index">#{seat.seatNumber + 1}</span>
                    <span className="seat-name">{seat.player?.displayName ?? 'Open Seat'}</span>
                    {seat.isButton && <span className="seat-badge">D</span>}
                  </div>
                  <div className="seat-meta-row">
                    <span>{seat.player ? `${formatAmount(seat.stack)} chips` : 'Available'}</span>
                    {showAction && playerAction && <span className="seat-action">{playerAction.action}</span>}
                  </div>
                  {seat.player && (
                    <div className="seat-mini-cards">
                      {Array.from({ length: 2 }).map((_, idx) => {
                        const cardValue = seat.cards[idx];
                        return cardValue
                          ? renderCard(cardValue, `overlay-${seat.seatNumber}-mini-${idx}`, { small: true })
                          : renderCardBack(`overlay-${seat.seatNumber}-mini-${idx}`, { small: true });
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="action-overlay">
            {currentEvent ? (
              <>
                <div className="event-title">{currentEvent.eventType}</div>
                <div className="event-message">{currentEvent.message}</div>
              </>
            ) : (
              <div className="event-placeholder">Waiting for action…</div>
            )}
            {gameState.lastAction && (
              <div className="event-last-action">
                Last action: <span>{gameState.lastAction}</span>
              </div>
            )}
          </div>
          <div className="table-overlay-bottom">
            <div className="timeline-overlay">
              {events.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (timelineIndex >= events.length - 1) {
                        setTimelineIndex(0);
                      }
                      setIsPlaying((prev) => !prev);
                    }}
                  >
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(events.length - 1, 0)}
                    value={timelineIndex}
                    onChange={(event) => {
                      setIsPlaying(false);
                      setTimelineIndex(Number(event.target.value));
                    }}
                  />
                  <span className="info-value">
                    {events.length === 0 ? '0/0' : `${timelineIndex + 1}/${events.length}`}
                  </span>
                </>
              ) : (
                <span className="info-value muted">Waiting for events…</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
