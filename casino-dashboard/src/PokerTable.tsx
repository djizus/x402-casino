import { useMemo } from 'react';
import type { RoomSnapshot, RoomEvent, PlayerSeat } from './types';

interface PokerTableProps {
  snapshot: RoomSnapshot;
  events: RoomEvent[];
}

interface PokerGameState {
  pot: number;
  currentBet: number;
  communityCards: string[];
  currentPlayer?: string;
  lastAction?: string;
  playerActions: Map<string, { action: string; timestamp: string }>;
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

const extractPokerState = (events: RoomEvent[]): PokerGameState => {
  const state: PokerGameState = {
    pot: 0,
    currentBet: 0,
    communityCards: [],
    lastAction: undefined,
    playerActions: new Map(),
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
        state.communityCards = event.payload.communityCards as string[];
      }
      if (event.payload.playerName) {
        state.currentPlayer = String(event.payload.playerName);
      }
    }

    // Extraire les actions des joueurs
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

export function PokerTable({ snapshot, events }: PokerTableProps) {
  const players = snapshot.summary?.players || [];
  const gameState = useMemo(() => extractPokerState(events), [events]);
  const maxSeats = 6; // Par défaut 6 sièges

  // Positions des sièges autour de la table (en pourcentage)
  const seatPositions = [
    { top: '10%', left: '50%', transform: 'translateX(-50%)' }, // Seat 0 - haut
    { top: '25%', left: '75%' }, // Seat 1 - droite haut
    { top: '60%', left: '75%' }, // Seat 2 - droite bas
    { top: '75%', left: '50%', transform: 'translateX(-50%)' }, // Seat 3 - bas
    { top: '60%', left: '5%' }, // Seat 4 - gauche bas
    { top: '25%', left: '5%' }, // Seat 5 - gauche haut
  ];

  const seats: (PlayerSeat | null)[] = Array(maxSeats).fill(null);
  players.forEach((player) => {
    if (player.seatNumber >= 0 && player.seatNumber < maxSeats) {
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
          {gameState.communityCards.length > 0 && (
            <div className="community-cards">
              {gameState.communityCards.map((card, idx) => {
                const formatted = formatCard(card);
                return (
                  <div key={idx} className={`playing-card ${formatted.className}`}>
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
              })}
            </div>
          )}

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

          return (
            <div key={seatNumber} style={{ ...seatPositions[seatNumber], position: 'absolute' }}>
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
                }`}
              >
                {player ? (
                  <>
                    <div className="player-name">{player.displayName}</div>
                    <div className="player-stack">{formatAmount(player.stack)}</div>
                    <div className="seat-number">#{seatNumber}</div>
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
          <span className="info-value">{players.length}/{maxSeats}</span>
        </div>
        {gameState.currentBet > 0 && (
          <div className="info-item">
            <span className="info-label">Current Bet:</span>
            <span className="info-value">{formatAmount(gameState.currentBet)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
