import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import { createRoom, fetchLobbyState, fetchRoomSnapshot, registerPlayer } from './api';
import type { LobbyGame, LobbyState, RoomSnapshot, RoomEvent } from './types';
import { PokerTable } from './PokerTable';

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL ?? 4000);

export function App() {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [loadingLobby, setLoadingLobby] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [gameOptions, setGameOptions] = useState<LobbyGame[]>([]);
  const [selectedGameType, setSelectedGameType] = useState('');
  const [createConfigValues, setCreateConfigValues] = useState<Record<string, string>>({});
  const [createForm, setCreateForm] = useState({ roomId: '' });
  const [createToast, setCreateToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    agentCardUrl: '',
    signupSkill: 'signup',
    actionSkill: 'play',
    preferredSeat: '',
  });
  const [registerToast, setRegisterToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const buildConfigDefaults = useCallback((game: LobbyGame | undefined) => {
    if (!game) return {};
    const defaults: Record<string, string> = {};
    const fallbackDefaults: Record<string, Record<string, number>> = {
      poker: {
        startingStack: 1000,
        smallBlind: 5,
        bigBlind: 10,
        minBuyIn: 100,
        maxBuyIn: 100,
        maxHands: 1000,
        maxPlayers: 8,
        buyInPriceUsd: 1,
      },
    };
    const fallback = fallbackDefaults[game.type] ?? {};
    game.configFields.forEach((field) => {
      const value = game.defaultConfig[field.key] ?? fallback[field.key];
      defaults[field.key] = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
    });
    return defaults;
  }, []);

  const refreshLobby = useCallback(async () => {
    const data = await fetchLobbyState();
    setLobby(data);
    const pokerGames = data.games.filter((game) => game.type === 'poker');
    setGameOptions(pokerGames);
    setLoadingLobby(false);

    if (!selectedRoomId && data.rooms.length > 0) {
      setSelectedRoomId(data.rooms[0].roomId);
    } else if (selectedRoomId && !data.rooms.some((room) => room.roomId === selectedRoomId)) {
      setSelectedRoomId(data.rooms[0]?.roomId ?? '');
    }

    const fallbackGame = pokerGames.find((game) => game.type === data.defaultGameType) ?? pokerGames[0];
    if ((!selectedGameType || !pokerGames.some((game) => game.type === selectedGameType)) && fallbackGame) {
      setSelectedGameType(fallbackGame.type);
      setCreateConfigValues(buildConfigDefaults(fallbackGame));
    } else if (!fallbackGame && selectedGameType) {
      setSelectedGameType('');
      setCreateConfigValues({});
    }
  }, [selectedRoomId, selectedGameType, buildConfigDefaults]);

  const refreshRoom = useCallback(async (roomId: string) => {
    if (!roomId) {
      setRoomSnapshot(null);
      return;
    }
    try {
      const snapshot = await fetchRoomSnapshot(roomId);
      setRoomSnapshot(snapshot);
    } catch (error) {
      console.error('Failed to fetch room:', error);
    }
  }, []);

  useEffect(() => {
    refreshLobby();
    const timer = setInterval(refreshLobby, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [refreshLobby]);

  useEffect(() => {
    if (!selectedRoomId) {
      setRoomSnapshot(null);
      return;
    }
    refreshRoom(selectedRoomId);
    const timer = setInterval(() => refreshRoom(selectedRoomId), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [selectedRoomId, refreshRoom]);

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateToast(null);
    const gameMap = new Map(gameOptions.map((game) => [game.type, game]));
    const game = gameMap.get(selectedGameType);
    if (!game) {
      setCreateToast({ kind: 'error', text: 'Select a game type first.' });
      return;
    }
    try {
      const config: Record<string, number> = {};
      for (const field of game.configFields) {
        const rawValue = createConfigValues[field.key];
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed)) {
          throw new Error(`Invalid value for ${field.label}.`);
        }
        config[field.key] = parsed;
      }
      const payload = {
        roomId: createForm.roomId.trim() || undefined,
        gameType: game.type,
        config,
      };
      const room = await createRoom(payload);
      setCreateToast({ kind: 'success', text: `Created room ${room.roomId}.` });
      setSelectedRoomId(room.roomId);
      setCreateForm({ roomId: '' });
      setCreateConfigValues(buildConfigDefaults(game));
      setShowCreateModal(false);
      refreshLobby();
    } catch (error) {
      setCreateToast({ kind: 'error', text: error instanceof Error ? error.message : 'Failed to create room.' });
    }
  };

  const events = useMemo(() => roomSnapshot?.events ?? [], [roomSnapshot]);
  const activityEvents = useMemo(() => {
    const recent = events.slice(-50);
    return [...recent].reverse();
  }, [events]);

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRoomId) {
      setRegisterToast({ kind: 'error', text: 'Select a room first.' });
      return;
    }
    setRegisterToast(null);
    try {
      const payload: any = {
        agentCardUrl: registerForm.agentCardUrl.trim(),
      };
      if (registerForm.signupSkill.trim()) payload.signupSkill = registerForm.signupSkill.trim();
      if (registerForm.actionSkill.trim()) payload.actionSkill = registerForm.actionSkill.trim();
      if (registerForm.preferredSeat.trim()) payload.preferredSeat = Number(registerForm.preferredSeat);
      await registerPlayer(selectedRoomId, payload);
      setRegisterToast({ kind: 'success', text: 'Player registered.' });
      setRegisterForm({
        agentCardUrl: '',
        signupSkill: 'signup',
        actionSkill: 'play',
        preferredSeat: '',
      });
      refreshRoom(selectedRoomId);
    } catch (error) {
      setRegisterToast({ kind: 'error', text: error instanceof Error ? error.message : 'Failed to register.' });
    }
  };

  const handleStartRoom = async () => {
    if (!selectedRoomId) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_CASINO_URL ?? 'http://localhost:4000'}/ui/rooms/${encodeURIComponent(selectedRoomId)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to start room');
      refreshRoom(selectedRoomId);
    } catch (error) {
      console.error('Failed to start room:', error);
    }
  };

  const formatAmount = (value: number | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
    return value.toLocaleString(undefined, {
      minimumFractionDigits: value < 1 ? 2 : 0,
      maximumFractionDigits: 4,
    });
  };

  if (loadingLobby) {
    return (
      <div className="app-container">
        <div className="main-view">
          <p>Loading casino lobby…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Top Bar */}
      <div className="top-bar">
        <h1>🎰 Lucid Casino</h1>
        <div className="rooms-tabs">
          {lobby?.rooms.map((room) => (
            <button
              key={room.roomId}
              className={`room-tab ${room.roomId === selectedRoomId ? 'active' : ''}`}
              onClick={() => setSelectedRoomId(room.roomId)}
              title={`${room.roomId} - ${room.status} - ${room.handCount} hands`}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>{room.roomId}</span>
                  <span className={`status-badge ${room.status}`} style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                    {room.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, display: 'flex', gap: '0.75rem' }}>
                  <span>👥 {room.playerCount}/{room.gameType === 'poker' ? '8' : '4'}</span>
                  <span>🃏 {room.handCount} hands</span>
                </div>
              </div>
            </button>
          ))}
          <button className="create-room-btn" onClick={() => setShowCreateModal(true)}>
            + New Room
          </button>
        </div>
      </div>

      {/* Main View */}
      <div className="main-view">
        <div className="table-area">
          {!selectedRoomId || !roomSnapshot ? (
            <div style={{ textAlign: 'center' }}>
              <h2>No room selected</h2>
              <p>Create a room or select one from the tabs above</p>
            </div>
          ) : (
            <>
              <div className="card poker-panel">
                {roomSnapshot.gameType === 'poker' ? (
                  <PokerTable snapshot={roomSnapshot} events={events} />
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <h2>{roomSnapshot.gameType}</h2>
                    <p>Game type: {roomSnapshot.gameType}</p>
                    <p>Players: {roomSnapshot.summary?.players.length ?? 0}</p>
                    <p>Status: {roomSnapshot.summary?.status ?? 'waiting'}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Side Panel */}
        {selectedRoomId && roomSnapshot && (
          <div className={`side-panel ${sidePanelCollapsed ? 'collapsed' : ''}`}>
            {!sidePanelCollapsed && (
              <>
                {/* Room Info */}
                <div className="section-box">
                  <h3>Room Info</h3>
                  <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div>
                      <strong>ID:</strong> {roomSnapshot.roomId}
                    </div>
                    <div>
                      <strong>Type:</strong> {roomSnapshot.gameType}
                    </div>
                    <div>
                      <strong>Status:</strong>{' '}
                      <span className={`status-badge ${roomSnapshot.summary?.status ?? 'waiting'}`}>
                        {roomSnapshot.summary?.status ?? 'waiting'}
                      </span>
                    </div>
                    <div>
                      <strong>Players:</strong> {roomSnapshot.summary?.players.length ?? 0}
                    </div>
                    <div>
                      <strong>Hands:</strong> {roomSnapshot.summary?.handCount ?? 0}
                    </div>
                    {roomSnapshot.gameType === 'poker' && roomSnapshot.config && (
                      <>
                        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                          <strong>Configuration</strong>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          {roomSnapshot.config.smallBlind !== undefined && (
                            <div>
                              <strong>SB:</strong> {formatAmount(Number(roomSnapshot.config.smallBlind))}
                            </div>
                          )}
                          {roomSnapshot.config.bigBlind !== undefined && (
                            <div>
                              <strong>BB:</strong> {formatAmount(Number(roomSnapshot.config.bigBlind))}
                            </div>
                          )}
                          {roomSnapshot.config.startingStack !== undefined && (
                            <div>
                              <strong>Stack:</strong> {formatAmount(Number(roomSnapshot.config.startingStack))}
                            </div>
                          )}
                          {roomSnapshot.config.minBuyIn !== undefined && (
                            <div>
                              <strong>Min:</strong> {formatAmount(Number(roomSnapshot.config.minBuyIn))}
                            </div>
                          )}
                          {roomSnapshot.config.maxBuyIn !== undefined && (
                            <div>
                              <strong>Max:</strong> {formatAmount(Number(roomSnapshot.config.maxBuyIn))}
                            </div>
                          )}
                          {roomSnapshot.config.buyInPriceUsd !== undefined && (
                            <div>
                              <strong>Buy-in:</strong> $
                              {formatAmount(Number(roomSnapshot.config.buyInPriceUsd))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="action-buttons">
                    <button onClick={handleStartRoom}>Start Room</button>
                  </div>
                </div>

                {/* Players List */}
                <div className="section-box">
                  <h3>Players</h3>
                  {roomSnapshot.summary?.players && roomSnapshot.summary.players.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {roomSnapshot.summary.players.map((player) => (
                        <div
                          key={player.playerId}
                          style={{
                            background: 'rgba(0, 0, 0, 0.3)',
                            padding: '0.5rem',
                            borderRadius: '6px',
                            fontSize: '0.85rem',
                          }}
                        >
                          <div>
                            <strong>{player.displayName}</strong>
                          </div>
                          <div style={{ opacity: 0.7 }}>
                            Seat {player.seatNumber} • Stack: {formatAmount(player.stack)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.85rem', opacity: 0.6 }}>No players yet</p>
                  )}
                </div>

                {/* Register Player */}
                <div className="section-box">
                  <h3>Register Player</h3>
                  <form onSubmit={handleRegister}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div>
                        <label htmlFor="agentCardUrl" style={{ fontSize: '0.8rem' }}>
                          Agent Card URL
                        </label>
                        <input
                          id="agentCardUrl"
                          required
                          value={registerForm.agentCardUrl}
                          onChange={(e) => setRegisterForm((prev) => ({ ...prev, agentCardUrl: e.target.value }))}
                          placeholder="http://localhost:8787/.well-known/agent-card.json"
                          style={{ fontSize: '0.8rem', padding: '0.4rem 0.5rem' }}
                        />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                        <div>
                          <label htmlFor="signupSkill" style={{ fontSize: '0.8rem' }}>
                            Signup Skill
                          </label>
                          <input
                            id="signupSkill"
                            value={registerForm.signupSkill}
                            onChange={(e) => setRegisterForm((prev) => ({ ...prev, signupSkill: e.target.value }))}
                            style={{ fontSize: '0.8rem', padding: '0.4rem 0.5rem' }}
                          />
                        </div>
                        <div>
                          <label htmlFor="actionSkill" style={{ fontSize: '0.8rem' }}>
                            Action Skill
                          </label>
                          <input
                            id="actionSkill"
                            value={registerForm.actionSkill}
                            onChange={(e) => setRegisterForm((prev) => ({ ...prev, actionSkill: e.target.value }))}
                            style={{ fontSize: '0.8rem', padding: '0.4rem 0.5rem' }}
                          />
                        </div>
                      </div>
                      <button type="submit" style={{ width: '100%' }}>
                        Register
                      </button>
                    </div>
                    {registerToast && (
                      <div className="toast" data-kind={registerToast.kind} style={{ marginTop: '0.5rem' }}>
                        {registerToast.text}
                      </div>
                    )}
                  </form>
                </div>

                {/* Activity */}
                <div className="section-box">
                  <h3>Activity</h3>
                  <div
                    style={{
                      maxHeight: '300px',
                      overflowY: 'auto',
                      fontSize: '0.8rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                    }}
                  >
                    {activityEvents.length > 0 ? (
                      activityEvents.map((event: RoomEvent, idx: number) => (
                        <div
                          key={`${event.timestamp}-${idx}`}
                          style={{
                            background: 'rgba(0, 0, 0, 0.3)',
                            padding: '0.4rem',
                            borderRadius: '4px',
                          }}
                        >
                          <div style={{ opacity: 0.6, fontSize: '0.7rem' }}>
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </div>
                          <div>{event.message}</div>
                        </div>
                      ))
                    ) : (
                      <p style={{ opacity: 0.6 }}>No activity yet</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create New Room</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                ×
              </button>
            </div>
            <form onSubmit={handleCreateRoom}>
              <div className="grid">
                <div>
                  <label htmlFor="roomId">Room ID</label>
                  <input
                    id="roomId"
                    value={createForm.roomId}
                    onChange={(e) => setCreateForm({ roomId: e.target.value })}
                    placeholder="Optional (auto-generated)"
                  />
                </div>
                <div>
                  <label htmlFor="gameType">Game Type</label>
                  <select
                    id="gameType"
                    value={selectedGameType}
                    onChange={(e) => {
                      const nextType = e.target.value;
                      setSelectedGameType(nextType);
                      const gameMap = new Map(gameOptions.map((game) => [game.type, game]));
                      setCreateConfigValues(buildConfigDefaults(gameMap.get(nextType)));
                    }}
                  >
                    <option value="" disabled>
                      Select a game
                    </option>
                    {gameOptions.map((game) => (
                      <option key={game.type} value={game.type}>
                        {game.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedGameType && (() => {
                const gameMap = new Map(gameOptions.map((game) => [game.type, game]));
                const game = gameMap.get(selectedGameType);
                return game ? (
                  <>
                    <p style={{ marginTop: '1rem', fontSize: '0.9rem', opacity: 0.8 }}>{game.description}</p>
                    <div className="grid" style={{ marginTop: '1rem' }}>
                      {game.configFields.map((field) => (
                        <div key={field.key}>
                          <label htmlFor={`create-${field.key}`}>{field.label}</label>
                          <input
                            id={`create-${field.key}`}
                            type="number"
                            step={field.step ?? 0.1}
                            min={field.min}
                            max={field.max}
                            required
                            value={createConfigValues[field.key] ?? ''}
                            onChange={(e) =>
                              setCreateConfigValues((prev) => ({
                                ...prev,
                                [field.key]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ) : null;
              })()}
              <button type="submit" style={{ marginTop: '1.5rem', width: '100%' }}>
                Create Room
              </button>
              {createToast && (
                <div className="toast" data-kind={createToast.kind}>
                  {createToast.text}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
