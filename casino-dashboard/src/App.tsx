import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import { fetchCasinoState, registerPlayer, startGame } from './api';
import type { CasinoState } from './types';

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

const defaultRegisterForm = {
  agentCardUrl: '',
  signupSkill: '',
  actionSkill: '',
  preferredSeat: '',
};

export function App() {
  const [casinoState, setCasinoState] = useState<CasinoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [registerForm, setRegisterForm] = useState(defaultRegisterForm);
  const [registerToast, setRegisterToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [startToast, setStartToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [startConfig, setStartConfig] = useState({
    startingStack: 1,
    smallBlind: 0.1,
    bigBlind: 1,
    minBuyIn: 0.1,
    maxBuyIn: 1,
    maxHands: 1,
  });

  const refresh = useCallback(async () => {
    const data = await fetchCasinoState();
    setCasinoState(data);
    setStartConfig({
      startingStack: data.config.startingStack,
      smallBlind: data.config.smallBlind,
      bigBlind: data.config.bigBlind,
      minBuyIn: data.config.minBuyIn,
      maxBuyIn: data.config.maxBuyIn,
      maxHands: data.config.maxHands,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRegisterToast(null);
    try {
      const payload: any = {
        agentCardUrl: registerForm.agentCardUrl,
      };
      if (registerForm.signupSkill.trim()) payload.signupSkill = registerForm.signupSkill.trim();
      if (registerForm.actionSkill.trim()) payload.actionSkill = registerForm.actionSkill.trim();
      if (registerForm.preferredSeat.trim()) payload.preferredSeat = Number(registerForm.preferredSeat);
      await registerPlayer(payload);
      setRegisterToast({ kind: 'success', text: 'Player registered.' });
      setRegisterForm(defaultRegisterForm);
      refresh();
    } catch (error) {
      setRegisterToast({ kind: 'error', text: error instanceof Error ? error.message : 'Failed to register.' });
    }
  };

  const handleStartGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStartToast(null);
    try {
      await startGame({
        startingStack: startConfig.startingStack,
        smallBlind: startConfig.smallBlind,
        bigBlind: startConfig.bigBlind,
        minBuyIn: startConfig.minBuyIn,
        maxBuyIn: startConfig.maxBuyIn,
        maxHands: startConfig.maxHands,
      });
      setStartToast({ kind: 'success', text: 'Game started.' });
      refresh();
    } catch (error) {
      setStartToast({ kind: 'error', text: error instanceof Error ? error.message : 'Failed to start game.' });
    }
  };

  const players = casinoState?.summary.players ?? [];
  const events = useMemo(() => casinoState?.events ?? [], [casinoState]);

  if (loading) {
    return (
      <main>
        <div className="card">
          <p>Loading casino state…</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <section className="card">
        <h1>Lucid Casino</h1>
        <p>
          Table <strong>{casinoState?.summary.tableId}</strong>
        </p>
        <div className="grid">
          <div>
            <div>Status</div>
            <div className="status-pill" data-status={casinoState?.summary.status}>
              {casinoState?.summary.status}
            </div>
          </div>
          <div>
            <div>Hands Played</div>
            <strong>{casinoState?.summary.handCount ?? 0}</strong>
          </div>
          <div>
            <div>Players</div>
            <strong>{players.length}</strong>
          </div>
          <div>
            <div>Blinds</div>
            <strong>
              {formatAmount(casinoState?.config.smallBlind)} / {formatAmount(casinoState?.config.bigBlind)}
            </strong>
          </div>
          <div>
            <div>Buy-ins</div>
            <strong>
              {formatAmount(casinoState?.config.minBuyIn)} - {formatAmount(casinoState?.config.maxBuyIn)}
            </strong>
          </div>
        </div>
        <p>{casinoState?.summary.message || 'No recent activity.'}</p>
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

      <section className="card">
        <h2>Game Controls</h2>
        <form onSubmit={handleStartGame}>
          <div className="grid">
            {(['startingStack', 'smallBlind', 'bigBlind', 'minBuyIn', 'maxBuyIn', 'maxHands'] as const).map((key) => (
              <div key={key}>
                <label htmlFor={key}>{key}</label>
                <input
                  id={key}
                  type="number"
                  step="0.01"
                  value={startConfig[key]}
                  onChange={(e) =>
                    setStartConfig((prev) => ({
                      ...prev,
                      [key]: e.target.value === '' ? 0 : Number(e.target.value),
                    }))
                  }
                  required
                />
              </div>
            ))}
          </div>
          <button type="submit">Start Game</button>
          {startToast && (
            <div className="toast" data-kind={startToast.kind}>
              {startToast.text}
            </div>
          )}
        </form>
      </section>

      <section className="card">
        <h2>Players</h2>
        {players.length === 0 ? (
          <p>No players registered yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Seat</th>
                <th>Name</th>
                <th>Stack</th>
                <th>Skill</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.playerId}>
                  <td>{player.seatNumber}</td>
                  <td>{player.displayName}</td>
                  <td>{formatAmount(player.stack)}</td>
                  <td>{player.actionSkill}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Activity</h2>
        {events.length === 0 ? (
          <p>No events recorded.</p>
        ) : (
          <ul className="events">
            {events
              .slice(-50)
              .reverse()
              .map((event) => (
                <li key={event}>{event}</li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}
