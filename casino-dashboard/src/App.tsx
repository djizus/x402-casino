import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import { createRoom, fetchLobbyState, fetchRoomSnapshot, registerPlayer } from './api';
import type { LobbyGame, LobbyState, RoomSnapshot, RoomEvent } from './types';

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL ?? 4000);

const formatAmount = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '–';
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value < 1 ? 2 : 0,
    maximumFractionDigits: 4,
  });
};

const defaultCreateForm = {
  roomId: '',
};

const defaultRegisterForm = {
  agentCardUrl: '',
  signupSkill: '',
  actionSkill: '',
  preferredSeat: '',
};

export function App() {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [loadingLobby, setLoadingLobby] = useState(true);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [gameOptions, setGameOptions] = useState<LobbyGame[]>([]);
  const [selectedGameType, setSelectedGameType] = useState('');
  const [createConfigValues, setCreateConfigValues] = useState<Record<string, string>>({});
  const [createForm, setCreateForm] = useState(defaultCreateForm);
  const [registerForm, setRegisterForm] = useState(defaultRegisterForm);
  const [createToast, setCreateToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [registerToast, setRegisterToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [createInitialized, setCreateInitialized] = useState(false);

  const buildConfigDefaults = useCallback(
    (game: LobbyGame | undefined) => {
      if (!game) {
        return {};
      }
      const defaults: Record<string, string> = {};
      game.configFields.forEach((field) => {
        const value = game.defaultConfig[field.key];
        defaults[field.key] =
          typeof value === 'number' || typeof value === 'string' ? String(value) : '';
      });
      return defaults;
    },
    [],
  );

  const refreshLobby = useCallback(async () => {
    const data = await fetchLobbyState();
    setLobby(data);
    setGameOptions(data.games);
    setLoadingLobby(false);

    if (!selectedRoomId) {
      setSelectedRoomId(data.rooms[0]?.roomId ?? '');
    } else if (!data.rooms.some((room) => room.roomId === selectedRoomId)) {
      setSelectedRoomId(data.rooms[0]?.roomId ?? '');
    }

    const fallbackGame =
      data.games.find((game) => game.type === data.defaultGameType) ?? data.games[0];

    if ((!selectedGameType || !data.games.some((game) => game.type === selectedGameType)) && fallbackGame) {
      setSelectedGameType(fallbackGame.type);
      setCreateConfigValues(buildConfigDefaults(fallbackGame));
      setCreateInitialized(true);
    } else if (!createInitialized) {
      const currentGame = data.games.find((game) => game.type === selectedGameType);
      if (currentGame) {
        setCreateConfigValues(buildConfigDefaults(currentGame));
        setCreateInitialized(true);
      }
    }
  }, [selectedRoomId, selectedGameType, createInitialized, buildConfigDefaults]);

  const refreshRoom = useCallback(
    async (roomId: string) => {
      if (!roomId) {
        setRoomSnapshot(null);
        return;
      }
      setLoadingRoom(true);
      try {
        const snapshot = await fetchRoomSnapshot(roomId);
        setRoomSnapshot(snapshot);
      } finally {
        setLoadingRoom(false);
      }
    },
    [],
  );

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
    const timer = setInterval(() => {
      refreshRoom(selectedRoomId);
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [selectedRoomId, refreshRoom]);

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateToast(null);
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
      setCreateForm(defaultCreateForm);
      setCreateConfigValues(buildConfigDefaults(game));
      setCreateInitialized(true);
      refreshLobby();
    } catch (error) {
      setCreateToast({ kind: 'error', text: error instanceof Error ? error.message : 'Failed to create room.' });
    }
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRoomId) {
      setRegisterToast({ kind: 'error', text: 'Select a room first.' });
      return;
    }
    if (activeRoomGame && !activeRoomGame.supportsRegistration) {
      setRegisterToast({ kind: 'error', text: 'This room type does not accept registrations.' });
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
      setRegisterForm(defaultRegisterForm);
      refreshRoom(selectedRoomId);
    } catch (error) {
      setRegisterToast({ kind: 'error', text: error instanceof Error ? error.message : 'Failed to register.' });
    }
  };

  const players = roomSnapshot?.summary?.players ?? [];
  const gameMap = useMemo(() => new Map(gameOptions.map((game) => [game.type, game])), [gameOptions]);
  const activeRoomGame = roomSnapshot ? gameMap.get(roomSnapshot.gameType) : undefined;
  const events = useMemo<RoomEvent[]>(() => {
    const items = roomSnapshot?.events ?? [];
    return items.slice(-50).reverse();
  }, [roomSnapshot]);

  if (loadingLobby) {
    return (
      <main>
        <div className="card">
          <p>Loading casino lobby…</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <section className="card">
        <h1>Lucid Casino Lobby</h1>
        <p>Manage rooms and monitor activity from one place.</p>
        <div className="room-list">
          {lobby?.rooms.length ? (
            lobby.rooms.map((room) => (
              <button
                key={room.roomId}
                className="room-chip"
                data-selected={room.roomId === selectedRoomId}
                onClick={() => setSelectedRoomId(room.roomId)}
              >
                <div>
                  <strong>{room.roomId}</strong>
                  <div>Game: {gameMap.get(room.gameType)?.label ?? room.gameType}</div>
                </div>
                <div className="status-pill" data-status={room.status}>
                  {room.status}
                </div>
                <div>{room.playerCount} players · {room.handCount} rounds</div>
                {room.roomBaseUrl && <small>{room.roomBaseUrl}</small>}
                {room.message && <small>{room.message}</small>}
              </button>
            ))
          ) : (
            <p>No rooms yet. Create one below.</p>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Create Room</h2>
        <form onSubmit={handleCreateRoom}>
          <div className="grid">
            <div>
              <label htmlFor="roomId">Room ID</label>
              <input
                id="roomId"
                value={createForm.roomId}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, roomId: e.target.value }))}
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
                  setCreateConfigValues(buildConfigDefaults(gameMap.get(nextType)));
                  setCreateInitialized(true);
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
          {selectedGameType && gameMap.get(selectedGameType)?.description && (
            <p>{gameMap.get(selectedGameType)!.description}</p>
          )}
          {selectedGameType && gameMap.get(selectedGameType) && (
            <div className="grid">
              {gameMap.get(selectedGameType)!.configFields.map((field) => (
                <div key={field.key}>
                  <label htmlFor={`create-${field.key}`}>{field.label}</label>
                  <input
                    id={`create-${field.key}`}
                    type={field.type === 'number' ? 'number' : 'text'}
                    step={field.step ?? (field.type === 'number' ? 0.1 : undefined)}
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
                  {field.helperText && <small>{field.helperText}</small>}
                </div>
              ))}
            </div>
          )}
          <button type="submit">Create Room</button>
          {createToast && (
            <div className="toast" data-kind={createToast.kind}>
              {createToast.text}
            </div>
          )}
        </form>
      </section>

      <section className="card">
        <h2>Room Details</h2>
        {!selectedRoomId ? (
          <p>Select a room to inspect details.</p>
        ) : loadingRoom ? (
          <p>Loading room {selectedRoomId}…</p>
        ) : roomSnapshot ? (
          <>
            <p>
              Room <strong>{roomSnapshot.roomId}</strong> ·{' '}
              <strong>{gameMap.get(roomSnapshot.gameType)?.label ?? roomSnapshot.gameType}</strong>
            </p>
            <div className="grid">
              <div>
                <div>Status</div>
                <div className="status-pill" data-status={roomSnapshot.summary?.status ?? 'waiting'}>
                  {roomSnapshot.summary?.status ?? 'waiting'}
                </div>
              </div>
              <div>
                <div>Rounds Played</div>
                <strong>{roomSnapshot.summary?.handCount ?? 0}</strong>
              </div>
              <div>
                <div>Players</div>
                <strong>{players.length}</strong>
              </div>
              {roomSnapshot.roomBaseUrl && (
                <div>
                  <div>Room Endpoint</div>
                  <a href={roomSnapshot.roomBaseUrl} target="_blank" rel="noreferrer">
                    {roomSnapshot.roomBaseUrl}
                  </a>
                </div>
              )}
              <div>
                <div>Agent Card</div>
                <small>{roomSnapshot.roomAgentCardUrl}</small>
              </div>
            </div>
            {Object.keys(roomSnapshot.config ?? {}).length > 0 && (
              <>
                <h3>Configuration</h3>
                <div className="grid">
                  {Object.entries(roomSnapshot.config).map(([key, value]) => (
                    <div key={key}>
                      <div>{key}</div>
                      <strong>
                        {typeof value === 'number' ? formatAmount(value) : String(value)}
                      </strong>
                    </div>
                  ))}
                </div>
              </>
            )}
            {activeRoomGame && !activeRoomGame.supportsRegistration && (
              <p>This room type manages its roster automatically.</p>
            )}
            <p>{roomSnapshot.summary?.message || 'No recent activity.'}</p>
          </>
        ) : (
          <p>Room not found.</p>
        )}
      </section>

      {selectedRoomId && activeRoomGame?.supportsRegistration && (
        <>
          <section className="card">
            <h2>Register Player</h2>
            <form onSubmit={handleRegister}>
              <div className="grid">
                <div>
                  <label htmlFor="agentCardUrl">Agent Card URL</label>
                  <input
                    id="agentCardUrl"
                    required
                    value={registerForm.agentCardUrl}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, agentCardUrl: e.target.value }))}
                    placeholder="http://localhost:4101/.well-known/agent-card.json"
                  />
                </div>
                <div>
                  <label htmlFor="signupSkill">Signup Skill</label>
                  <input
                    id="signupSkill"
                    value={registerForm.signupSkill}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, signupSkill: e.target.value }))}
                    placeholder="signup"
                  />
                </div>
                <div>
                  <label htmlFor="actionSkill">Action Skill</label>
                  <input
                    id="actionSkill"
                    value={registerForm.actionSkill}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, actionSkill: e.target.value }))}
                    placeholder="act"
                  />
                </div>
                <div>
                  <label htmlFor="preferredSeat">Preferred Seat</label>
                  <input
                    id="preferredSeat"
                    value={registerForm.preferredSeat}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, preferredSeat: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <button type="submit">Register Agent</button>
              {registerToast && (
                <div className="toast" data-kind={registerToast.kind}>
                  {registerToast.text}
                </div>
              )}
            </form>
          </section>
        </>
      )}

      <section className="card">
        <h2>Activity</h2>
        {!selectedRoomId ? (
          <p>Select a room to view activity.</p>
        ) : events.length === 0 ? (
          <p>No events recorded.</p>
        ) : (
          <ul className="events">
            {events.map((event: RoomEvent) => (
              <li key={`${event.timestamp}-${event.message}`}>
                <strong>{new Date(event.timestamp).toLocaleTimeString()}</strong> · {event.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
