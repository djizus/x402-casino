import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import { createRoom, fetchLobbyState, fetchRoomSnapshot, registerPlayer, startRoom } from './api';
import type { LobbyState, RoomSnapshot, TableEvent } from './types';

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL ?? 4000);
const DEFAULT_TABLE_AGENT_CARD_URL = import.meta.env.VITE_TABLE_AGENT_CARD_URL ?? '';

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
  tableId: '',
  tableAgentCardUrl: DEFAULT_TABLE_AGENT_CARD_URL,
  tablePort: '',
  startingStack: '1',
  smallBlind: '0.1',
  bigBlind: '1',
  minBuyIn: '0.1',
  maxBuyIn: '1',
  maxHands: '1',
  maxSeats: '6',
};

const defaultRegisterForm = {
  agentCardUrl: '',
  signupSkill: '',
  actionSkill: '',
  preferredSeat: '',
};

const defaultStartForm = {
  maxHands: '',
  smallBlind: '',
  bigBlind: '',
};

export function App() {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [loadingLobby, setLoadingLobby] = useState(true);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [createForm, setCreateForm] = useState(defaultCreateForm);
  const [registerForm, setRegisterForm] = useState(defaultRegisterForm);
  const [startForm, setStartForm] = useState(defaultStartForm);
  const [createToast, setCreateToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [registerToast, setRegisterToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [startToast, setStartToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [createInitialized, setCreateInitialized] = useState(false);

  const refreshLobby = useCallback(async () => {
    const data = await fetchLobbyState();
    setLobby(data);
    setLoadingLobby(false);

    if (!selectedRoomId) {
      setSelectedRoomId(data.rooms[0]?.roomId ?? '');
    } else if (!data.rooms.some((room) => room.roomId === selectedRoomId)) {
      setSelectedRoomId(data.rooms[0]?.roomId ?? '');
    }

    if (!createInitialized) {
      setCreateForm((prev) => ({
        ...prev,
        startingStack: String(data.defaultConfig.startingStack),
        smallBlind: String(data.defaultConfig.smallBlind),
        bigBlind: String(data.defaultConfig.bigBlind),
        minBuyIn: String(data.defaultConfig.minBuyIn),
        maxBuyIn: String(data.defaultConfig.maxBuyIn),
        maxHands: String(data.defaultConfig.maxHands),
        tableAgentCardUrl: prev.tableAgentCardUrl || DEFAULT_TABLE_AGENT_CARD_URL,
        maxSeats: String(data.defaultConfig.maxSeats),
      }));
      setCreateInitialized(true);
    }
  }, [selectedRoomId, createInitialized]);

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
    try {
      const payload = {
        roomId: createForm.roomId.trim() || undefined,
        tableId: createForm.tableId.trim() || undefined,
        tableAgentCardUrl: createForm.tableAgentCardUrl.trim() || undefined,
        tablePort: createForm.tablePort.trim() ? Number(createForm.tablePort) : undefined,
        startingStack: Number(createForm.startingStack),
        smallBlind: Number(createForm.smallBlind),
        bigBlind: Number(createForm.bigBlind),
        minBuyIn: Number(createForm.minBuyIn),
        maxBuyIn: Number(createForm.maxBuyIn),
        maxHands: Number(createForm.maxHands),
        maxSeats: Number(createForm.maxSeats),
      };
      const room = await createRoom(payload);
      setCreateToast({ kind: 'success', text: `Created room ${room.roomId}.` });
      setSelectedRoomId(room.roomId);
      setCreateForm(defaultCreateForm);
      setCreateInitialized(false);
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

  const handleStartRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRoomId) {
      setStartToast({ kind: 'error', text: 'Select a room first.' });
      return;
    }
    setStartToast(null);
    try {
      const payload: any = {};
      if (startForm.maxHands.trim()) payload.maxHands = Number(startForm.maxHands);
      if (startForm.smallBlind.trim()) payload.smallBlind = Number(startForm.smallBlind);
      if (startForm.bigBlind.trim()) payload.bigBlind = Number(startForm.bigBlind);
      await startRoom(selectedRoomId, payload);
      setStartToast({ kind: 'success', text: 'Room started.' });
      refreshRoom(selectedRoomId);
    } catch (error) {
      setStartToast({ kind: 'error', text: error instanceof Error ? error.message : 'Failed to start room.' });
    }
  };

  const players = roomSnapshot?.summary?.players ?? [];
  const events = useMemo<TableEvent[]>(() => {
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
                  <strong>{room.roomId}</strong> · {room.tableId}
                </div>
                <div className="status-pill" data-status={room.status}>
                  {room.status}
                </div>
                <div>{room.playerCount} players · {room.handCount} hands</div>
                {room.tableBaseUrl && <small>{room.tableBaseUrl}</small>}
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
              <label htmlFor="tableId">Table ID</label>
              <input
                id="tableId"
                value={createForm.tableId}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, tableId: e.target.value }))}
                placeholder="Defaults to room ID"
              />
            </div>
            <div>
              <label htmlFor="tableAgentCardUrl">Table Agent Card URL</label>
              <input
                id="tableAgentCardUrl"
                value={createForm.tableAgentCardUrl}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, tableAgentCardUrl: e.target.value }))}
                placeholder="Auto-spawn (optional override)"
              />
            </div>
            <div>
              <label htmlFor="tablePort">Table Port</label>
              <input
                id="tablePort"
                value={createForm.tablePort}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, tablePort: e.target.value }))}
                placeholder="Auto-select"
              />
            </div>
            {(
              ['startingStack', 'smallBlind', 'bigBlind', 'minBuyIn', 'maxBuyIn', 'maxHands', 'maxSeats'] as const
            ).map((key) => (
              <div key={key}>
                <label htmlFor={`create-${key}`}>{key}</label>
                <input
                  id={`create-${key}`}
                  type="number"
                  step={key === 'maxSeats' ? 1 : 0.01}
                  min={key === 'maxSeats' ? 2 : undefined}
                  max={key === 'maxSeats' ? 10 : undefined}
                  required
                  value={(createForm as Record<string, string>)[key]}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
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
              Room <strong>{roomSnapshot.roomId}</strong> · Table <strong>{roomSnapshot.summary?.tableId}</strong>
            </p>
            <div className="grid">
              <div>
                <div>Status</div>
                <div className="status-pill" data-status={roomSnapshot.summary?.status ?? 'waiting'}>
                  {roomSnapshot.summary?.status ?? 'waiting'}
                </div>
              </div>
              <div>
                <div>Hands Played</div>
                <strong>{roomSnapshot.summary?.handCount ?? 0}</strong>
              </div>
              <div>
                <div>Players</div>
                <strong>{players.length}</strong>
              </div>
              <div>
                <div>Blinds</div>
                <strong>
                  {formatAmount(roomSnapshot.config.smallBlind)} / {formatAmount(roomSnapshot.config.bigBlind)}
                </strong>
              </div>
              <div>
                <div>Buy-ins</div>
                <strong>
                  {formatAmount(roomSnapshot.config.minBuyIn)} - {formatAmount(roomSnapshot.config.maxBuyIn)}
                </strong>
              </div>
              {roomSnapshot.tableBaseUrl && (
                <div>
                  <div>Table Endpoint</div>
                  <a href={roomSnapshot.tableBaseUrl} target="_blank" rel="noreferrer">
                    {roomSnapshot.tableBaseUrl}
                  </a>
                </div>
              )}
              <div>
                <div>Agent Card</div>
                <small>{roomSnapshot.tableAgentCardUrl}</small>
              </div>
            </div>
            <p>{roomSnapshot.summary?.message || 'No recent activity.'}</p>
          </>
        ) : (
          <p>Room not found.</p>
        )}
      </section>

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
                disabled={!selectedRoomId}
              />
            </div>
            <div>
              <label htmlFor="signupSkill">Signup Skill</label>
              <input
                id="signupSkill"
                value={registerForm.signupSkill}
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, signupSkill: e.target.value }))}
                placeholder="signup"
                disabled={!selectedRoomId}
              />
            </div>
            <div>
              <label htmlFor="actionSkill">Action Skill</label>
              <input
                id="actionSkill"
                value={registerForm.actionSkill}
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, actionSkill: e.target.value }))}
                placeholder="act"
                disabled={!selectedRoomId}
              />
            </div>
            <div>
              <label htmlFor="preferredSeat">Preferred Seat</label>
              <input
                id="preferredSeat"
                value={registerForm.preferredSeat}
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, preferredSeat: e.target.value }))}
                placeholder="Optional"
                disabled={!selectedRoomId}
              />
            </div>
          </div>
          <button type="submit" disabled={!selectedRoomId}>
            Register Agent
          </button>
          {registerToast && (
            <div className="toast" data-kind={registerToast.kind}>
              {registerToast.text}
            </div>
          )}
        </form>
      </section>

      <section className="card">
        <h2>Room Controls</h2>
        <form onSubmit={handleStartRoom}>
          <div className="grid">
            {(['maxHands', 'smallBlind', 'bigBlind'] as const).map((key) => (
              <div key={key}>
                <label htmlFor={`start-${key}`}>{key}</label>
                <input
                  id={`start-${key}`}
                  type="number"
                  step="0.01"
                  value={(startForm as Record<string, string>)[key]}
                  onChange={(e) => setStartForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder="Leave blank for defaults"
                  disabled={!selectedRoomId}
                />
              </div>
            ))}
          </div>
          <button type="submit" disabled={!selectedRoomId}>
            Start Room
          </button>
          {startToast && (
            <div className="toast" data-kind={startToast.kind}>
              {startToast.text}
            </div>
          )}
        </form>
      </section>

      <section className="card">
        <h2>Players</h2>
        {!selectedRoomId ? (
          <p>Select a room.</p>
        ) : players.length === 0 ? (
          <p>No players registered yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Seat</th>
                <th>Name</th>
                <th>Stack</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.playerId}>
                  <td>{player.seatNumber}</td>
                  <td>{player.displayName}</td>
                  <td>{formatAmount(player.stack)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Activity</h2>
        {!selectedRoomId ? (
          <p>Select a room to view activity.</p>
        ) : events.length === 0 ? (
          <p>No events recorded.</p>
        ) : (
          <ul className="events">
            {events.map((event: TableEvent) => (
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
