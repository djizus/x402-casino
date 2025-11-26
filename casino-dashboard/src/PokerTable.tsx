import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomSnapshot, RoomEvent, PlayerSeat } from './types';

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
}

const stageLabels: Record<HandStage, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
};

const stageVisibleCounts: Record<HandStage, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
  showdown: 5,
};

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

const renderCardSlot = (key: string, variant: 'pending' | 'future'): JSX.Element => (
  <div key={key} className={`card-slot ${variant}`}>
    <div className="card-slot-inner" />
  </div>
);

const extractPokerState = (events: RoomEvent[]): PokerGameState => {
  const state: PokerGameState = {
    pot: 0,
    currentBet: 0,
    communityCards: [],
    lastAction: undefined,
    playerActions: new Map(),
    stage: 'preflop',
    winningHands: [],
    playerCards: new Map(),
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
    }

    if (event.eventType === 'action_taken') {
      state.lastAction = event.message;
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
      setIsPlaying(true);
      return;
    }
    setTimelineIndex((prev) => Math.min(prev, events.length - 1));
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

  const players = snapshot.summary?.players || [];
  const visibleEvents = useMemo(() => events.slice(0, timelineIndex + 1), [events, timelineIndex]);
  const gameState = useMemo(() => extractPokerState(visibleEvents), [visibleEvents]);
  const currentEvent = visibleEvents.length > 0 ? visibleEvents[visibleEvents.length - 1] : undefined;
  const configuredMaxPlayers = parseSeatCount(snapshot.config.maxPlayers);
  const maxPlayers = Math.max(2, configuredMaxPlayers ?? 6);
  const seatPositions = useMemo(() => buildSeatPositions(maxPlayers), [maxPlayers]);
  const smallBlind = parseConfigNumber(snapshot.config.smallBlind);
  const bigBlind = parseConfigNumber(snapshot.config.bigBlind);
  const minBuyIn = parseConfigNumber(snapshot.config.minBuyIn);
  const maxBuyIn = parseConfigNumber(snapshot.config.maxBuyIn);
  const startingStack = parseConfigNumber(snapshot.config.startingStack);
  const maxHands = parseSeatCount(snapshot.config.maxHands);
  const currentStage = gameState.stage ?? 'preflop';
  const stageLabel = stageLabels[currentStage];
  const stageVisibleCount = stageVisibleCounts[currentStage];
  const winningPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const hand of gameState.winningHands) {
      if (hand.playerId) {
        ids.add(hand.playerId);
      }
    }
    return ids;
  }, [gameState.winningHands]);

  const seats: (PlayerSeat | null)[] = Array(maxPlayers).fill(null);
  players.forEach((player) => {
    if (player.seatNumber >= 0 && player.seatNumber < maxPlayers) {
      seats[player.seatNumber] = player;
    }
  });

  return (
    <div className="poker-table-container">
      <div className="poker-table">
        {/* Table centrale */}
        <div className="table-surface">
          {/* Pot au centre */}
          <div className="pot-display">
            <div className="pot-label">POT</div>
            <div className="pot-amount">{formatAmount(gameState.pot)}</div>
          </div>

          {/* Cartes communautaires */}
          <div className="community-cards">
            {Array.from({ length: 5 }, (_, idx) => {
              const card = gameState.communityCards[idx];
              if (card) {
                return renderCard(card, `${card}-${idx}`, { delay: idx * 0.05 });
              }
              const variant = idx < stageVisibleCount ? 'pending' : 'future';
              return renderCardSlot(`slot-${idx}`, variant);
            })}
          </div>

          {/* Dernière action */}
          {gameState.lastAction && (
            <div className="last-action">
              {gameState.lastAction}
            </div>
          )}
        </div>

        {/* Sièges des joueurs */}
        {seats.map((player, seatNumber) => {
          const playerAction = player ? gameState.playerActions.get(player.displayName) : undefined;
          const showAction = playerAction && (Date.now() - new Date(playerAction.timestamp).getTime()) < 10000; // Afficher pendant 10s
          const seatStyle = seatPositions[seatNumber] ?? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
          const seatCards = player ? gameState.playerCards.get(player.playerId) : undefined;
          const revealCards = currentStage === 'showdown' && seatCards && seatCards.length > 0;
          const cardsForSeat = Array.from({ length: 2 }, (_, idx) =>
            revealCards && seatCards ? seatCards[idx] : undefined,
          );

          return (
            <div key={seatNumber} style={{ ...seatStyle, position: 'absolute' }}>
              {/* Bulle d'action */}
              {player && showAction && (
                <div className="action-bubble">
                  {playerAction.action}
                  <div className="action-bubble-arrow"></div>
                </div>
              )}

              {/* Siège du joueur */}
              <div
                className={`player-seat ${player ? 'occupied' : 'empty'} ${
                  gameState.currentPlayer === player?.displayName ? 'active' : ''
                } ${player && winningPlayerIds.has(player.playerId) ? 'winner' : ''}`}
              >
                {player ? (
                  <>
                    <div className="player-name">{player.displayName}</div>
                    <div className="player-stack">{formatAmount(player.stack)}</div>
                    <div className="seat-number">#{seatNumber}</div>
                    <div className="player-cards">
                      {cardsForSeat.map((cardValue, cardIdx) =>
                        cardValue
                          ? renderCard(cardValue, `seat-${seatNumber}-card-${cardIdx}`, {
                              small: true,
                              delay: cardIdx * 0.05,
                            })
                          : renderCardBack(`seat-${seatNumber}-back-${cardIdx}`, {
                              small: true,
                              delay: cardIdx * 0.05,
                            }),
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty-seat-label">Seat {seatNumber}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Informations de la partie */}
      <div className="game-info">
        {events.length > 0 && (
          <div className="timeline-controls">
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
              style={{ flex: 1, margin: '0 0.75rem' }}
            />
            <span className="info-value" style={{ minWidth: '4rem', textAlign: 'right' }}>
              {events.length === 0 ? '0/0' : `${timelineIndex + 1}/${events.length}`}
            </span>
          </div>
        )}
        <div className="info-item">
          <span className="info-label">Status:</span>
          <span className={`status-badge ${snapshot.summary?.status || 'waiting'}`}>
            {snapshot.summary?.status || 'waiting'}
          </span>
        </div>
        <div className="info-item">
          <span className="info-label">Hand:</span>
          <span className="info-value">#{snapshot.summary?.handCount || 0}</span>
        </div>
        <div className="info-item">
          <span className="info-label">Players:</span>
          <span className="info-value">{players.length}/{maxPlayers}</span>
        </div>
        {stageLabel && (
          <div className="info-item">
            <span className="info-label">Stage:</span>
            <span className="info-value">{stageLabel}</span>
          </div>
        )}
        {smallBlind !== undefined && bigBlind !== undefined && (
          <div className="info-item">
            <span className="info-label">Blinds:</span>
            <span className="info-value">{formatAmount(smallBlind)}/{formatAmount(bigBlind)}</span>
          </div>
        )}
        {minBuyIn !== undefined && maxBuyIn !== undefined && (
          <div className="info-item">
            <span className="info-label">Buy-in Range:</span>
            <span className="info-value">{formatAmount(minBuyIn)} – {formatAmount(maxBuyIn)}</span>
          </div>
        )}
        {startingStack !== undefined && (
          <div className="info-item">
            <span className="info-label">Starting Stack:</span>
            <span className="info-value">{formatAmount(startingStack)}</span>
          </div>
        )}
        {maxHands !== undefined && (
          <div className="info-item">
            <span className="info-label">Max Hands:</span>
            <span className="info-value">{maxHands}</span>
          </div>
        )}
        {gameState.currentBet > 0 && (
          <div className="info-item">
            <span className="info-label">Current Bet:</span>
            <span className="info-value">{formatAmount(gameState.currentBet)}</span>
          </div>
        )}
        {currentEvent && (
          <div className="info-item">
            <span className="info-label">Event:</span>
            <span className="info-value">{currentEvent.eventType}: {currentEvent.message}</span>
          </div>
        )}
        {gameState.winningHands.length > 0 && (
          <div className="winner-section">
            <div className="winner-title">Showdown</div>
            {gameState.winningHands.map((hand, idx) => (
              <div key={`${hand.displayName}-${idx}`} className="winner-item">
                <div>
                  <div className="winner-name">{hand.displayName}</div>
                  <div className="winner-description">
                    {hand.description ?? 'Winner'}
                    {typeof hand.amountWon === 'number' && (
                      <span style={{ marginLeft: '0.35rem' }}>• {formatAmount(hand.amountWon)}</span>
                    )}
                  </div>
                </div>
                <div className="winner-cards">
                  {hand.cards.length > 0
                    ? hand.cards.map((card, cardIdx) =>
                        renderCard(card, `${hand.displayName}-${card}-${cardIdx}`, {
                          small: true,
                          delay: cardIdx * 0.05,
                        }),
                      )
                    : <span className="info-value">Cards hidden</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
