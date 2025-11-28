import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import { ApiError, createRoom, fetchLobbyState, fetchRoomSnapshot, registerPlayer } from './api';
import { createPaymentHeader } from 'x402/client';
import type { PaymentRequirements } from 'x402/types';
import { createWalletClient, custom, type Account, type Transport, type WalletClient } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { LobbyGame, LobbyState, RoomSnapshot, RoomEvent, RegisterPayload } from './types';
import { PokerTable } from './PokerTable';

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL ?? 4000);
const BASE_SEPOLIA_CHAIN_ID_HEX = `0x${baseSepolia.id.toString(16)}`;

type RegisterFormState = {
  agentCardUrl: string;
  signupSkill: string;
  actionSkill: string;
  preferredSeat: string;
};

const DEFAULT_REGISTER_FORM: RegisterFormState = {
  agentCardUrl: '',
  signupSkill: 'signup',
  actionSkill: 'play',
  preferredSeat: '',
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

type DpsPaymentResponse = {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirements[];
};

type RegisterToast = {
  kind: 'success' | 'error';
  text: string;
  dpsPayment?: DpsPaymentResponse;
};

type BaseWalletClient = WalletClient<Transport, typeof baseSepolia, Account>;

type WalletState = {
  status: 'idle' | 'connecting' | 'connected';
  address?: string;
  client?: BaseWalletClient;
  error?: string | null;
};

const formatAtomicAmount = (value: string | undefined, decimals = 6) => {
  if (!value) return '';
  const scale = 10 ** decimals;
  const amount = Number(value) / scale;
  if (!Number.isFinite(amount)) return value;
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.min(decimals, 6),
  });
};

const shortenAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

const ensureBaseSepoliaNetwork = async (provider: EthereumProvider) => {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch (error: any) {
    if (error?.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
            chainName: baseSepolia.name,
            rpcUrls: baseSepolia.rpcUrls.default.http,
            nativeCurrency: baseSepolia.nativeCurrency,
            blockExplorerUrls: baseSepolia.blockExplorers ? [baseSepolia.blockExplorers.default.url] : undefined,
          },
        ],
      });
    } else {
      throw error;
    }
  }
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isPlainRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

const isDpsAccept = (value: unknown): value is PaymentRequirements => {
  if (!isPlainRecord(value) || typeof value.scheme !== 'string') return false;
  if ('extra' in value && value.extra !== undefined && !isStringRecord(value.extra)) return false;
  return true;
};

const isDpsPaymentResponse = (value: unknown): value is DpsPaymentResponse =>
  isPlainRecord(value) && typeof value.x402Version === 'number' && Array.isArray(value.accepts) && value.accepts.every(isDpsAccept);

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
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(() => ({ ...DEFAULT_REGISTER_FORM }));
  const [registerToast, setRegisterToast] = useState<RegisterToast | null>(null);
  const [walletState, setWalletState] = useState<WalletState>({ status: 'idle', error: null });
  const [isPaying, setIsPaying] = useState(false);

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

  const buildRegisterPayload = useCallback((): RegisterPayload => {
    const payload: RegisterPayload = {
      agentCardUrl: registerForm.agentCardUrl.trim(),
    };
    if (registerForm.signupSkill.trim()) payload.signupSkill = registerForm.signupSkill.trim();
    if (registerForm.actionSkill.trim()) payload.actionSkill = registerForm.actionSkill.trim();
    if (registerForm.preferredSeat.trim()) payload.preferredSeat = Number(registerForm.preferredSeat);
    return payload;
  }, [registerForm]);

  const resetRegisterForm = useCallback(() => {
    setRegisterForm({ ...DEFAULT_REGISTER_FORM });
  }, []);

  const handleRegisterSuccess = useCallback(
    (roomId: string, message = 'Player registered.') => {
      setRegisterToast({ kind: 'success', text: message });
      resetRegisterForm();
      refreshRoom(roomId);
    },
    [refreshRoom, resetRegisterForm],
  );

  const handleRegisterFailure = useCallback((error: unknown) => {
    if (error instanceof ApiError && isDpsPaymentResponse(error.body)) {
      setRegisterToast({
        kind: 'error',
        text: error.message || 'Payment required',
        dpsPayment: error.body,
      });
    } else {
      setRegisterToast({ kind: 'error', text: error instanceof Error ? error.message : 'Failed to register.' });
    }
  }, []);

  const selectedPaymentRequirements = useMemo<PaymentRequirements | null>(() => {
    const accepts = registerToast?.dpsPayment?.accepts;
    if (!accepts || accepts.length === 0) return null;
    const baseSepoliaOption = accepts.find((option) => option.scheme === 'exact' && option.network === 'base-sepolia');
    return baseSepoliaOption ?? accepts.find((option) => option.scheme === 'exact') ?? accepts[0];
  }, [registerToast]);

  const connectWallet = useCallback(async () => {
    const provider = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!provider) {
      setWalletState({
        status: 'idle',
        error: 'Install a browser wallet (e.g. MetaMask) to continue.',
      });
      return;
    }
    setWalletState((prev) => ({ ...prev, status: 'connecting', error: null }));
    try {
      await ensureBaseSepoliaNetwork(provider);
      const transport = custom(provider);
      const tempClient = createWalletClient({
        chain: baseSepolia,
        transport,
      });
      const addresses = await tempClient.requestAddresses();
      const address = addresses[0];
      if (!address) {
        throw new Error('Your wallet did not return any accounts.');
      }
      const client = createWalletClient({
        account: address,
        chain: baseSepolia,
        transport,
      }) as BaseWalletClient;
      setWalletState({
        status: 'connected',
        address,
        client,
        error: null,
      });
    } catch (error) {
      setWalletState({
        status: 'idle',
        address: undefined,
        client: undefined,
        error: error instanceof Error ? error.message : 'Failed to connect wallet.',
      });
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    setWalletState({ status: 'idle', address: undefined, client: undefined, error: null });
  }, []);

  const handlePayInvoice = useCallback(async () => {
    if (!selectedRoomId || !registerToast?.dpsPayment || !selectedPaymentRequirements) return;
    if (selectedPaymentRequirements.network !== 'base-sepolia') {
      setWalletState((prev) => ({
        ...prev,
        error: `Unsupported payment network "${selectedPaymentRequirements.network}".`,
      }));
      return;
    }
    if (!walletState.client) {
      setWalletState((prev) => ({ ...prev, error: 'Connect a wallet before paying.' }));
      return;
    }
    setIsPaying(true);
    try {
      const payload = buildRegisterPayload();
      const paymentHeader = await createPaymentHeader(
        walletState.client as unknown as Parameters<typeof createPaymentHeader>[0],
        registerToast.dpsPayment.x402Version,
        selectedPaymentRequirements,
      );
      await registerPlayer(selectedRoomId, payload, { paymentHeader });
      handleRegisterSuccess(selectedRoomId, 'Player registered after payment.');
    } catch (error) {
      handleRegisterFailure(error);
    } finally {
      setIsPaying(false);
    }
  }, [
    buildRegisterPayload,
    handleRegisterFailure,
    handleRegisterSuccess,
    registerToast,
    selectedPaymentRequirements,
    selectedRoomId,
    walletState.client,
  ]);

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRoomId) {
      setRegisterToast({ kind: 'error', text: 'Select a room first.' });
      return;
    }
    setRegisterToast(null);
    try {
      const payload = buildRegisterPayload();
      await registerPlayer(selectedRoomId, payload);
      handleRegisterSuccess(selectedRoomId);
    } catch (error) {
      handleRegisterFailure(error);
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

  const paymentAssetName = selectedPaymentRequirements?.extra?.name ?? 'USDC';
  const paymentAmountDisplay = selectedPaymentRequirements?.maxAmountRequired
    ? formatAtomicAmount(selectedPaymentRequirements.maxAmountRequired)
    : null;
  const walletConnected = walletState.status === 'connected';
  const supportedPaymentNetwork =
    !selectedPaymentRequirements || selectedPaymentRequirements.network === 'base-sepolia';
  const walletReady = walletConnected && supportedPaymentNetwork;
  const payButtonDisabled =
    !selectedRoomId || !selectedPaymentRequirements || !walletReady || isPaying;
  const payButtonText = isPaying
    ? 'Paying…'
    : selectedPaymentRequirements && paymentAmountDisplay
      ? `Pay ${paymentAmountDisplay} ${paymentAssetName}`
      : 'Pay now';

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
                        <div>{registerToast.text}</div>
                        {registerToast.dpsPayment && (
                          <div className="dps-payment-details">
                            <div className="dps-payment-header">
                              <span>{registerToast.dpsPayment.error ?? 'Payment required'}</span>
                              <span className="dps-payment-version">x402 v{registerToast.dpsPayment.x402Version}</span>
                            </div>
                            <p className="dps-payment-instructions">
                              Complete the payment with one of the options below to finish registration.
                            </p>
                            {registerToast.dpsPayment.accepts.length > 0 ? (
                              <div className="dps-payment-options">
                                {registerToast.dpsPayment.accepts.map((accept, idx) => {
                                  const assetLabel = accept.extra?.name
                                    ? accept.asset
                                      ? `${accept.extra.name} • ${accept.asset}`
                                      : accept.extra.name
                                    : accept.asset;
                                  const detailRows = [
                                    { label: 'Description', value: accept.description },
                                    { label: 'Resource', value: accept.resource },
                                    { label: 'Pay to', value: accept.payTo },
                                    { label: 'Asset', value: assetLabel },
                                    { label: 'Max amount', value: accept.maxAmountRequired },
                                    {
                                      label: 'Timeout',
                                      value:
                                        typeof accept.maxTimeoutSeconds === 'number'
                                          ? `${accept.maxTimeoutSeconds}s`
                                          : undefined,
                                    },
                                    { label: 'MIME type', value: accept.mimeType },
                                  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
                                  const extraEntries = accept.extra ? Object.entries(accept.extra) : [];
                                  return (
                                    <div key={`${accept.scheme}-${accept.resource ?? idx}`} className="dps-payment-option">
                                      <div className="dps-payment-option-title">
                                        Option {idx + 1}: {accept.scheme}
                                        {accept.network ? ` • ${accept.network}` : ''}
                                      </div>
                                      {detailRows.length > 0 && (
                                        <dl>
                                          {detailRows.map((row) => (
                                            <Fragment key={row.label}>
                                              <dt>{row.label}</dt>
                                              <dd>{row.value}</dd>
                                            </Fragment>
                                          ))}
                                        </dl>
                                      )}
                                      {extraEntries.length > 0 && (
                                        <div className="dps-payment-extra">
                                          <div className="dps-payment-option-subtitle">Extra metadata</div>
                                          <dl>
                                            {extraEntries.map(([key, value]) => (
                                              <Fragment key={key}>
                                                <dt>{key}</dt>
                                                <dd>{value}</dd>
                                              </Fragment>
                                            ))}
                                          </dl>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="dps-payment-empty">Payment instructions were not included in the response.</p>
                            )}
                            {registerToast.dpsPayment && (
                              <div className="dps-wallet-section">
                                <div className="dps-wallet-row">
                                  <div>
                                    <div className="dps-wallet-label">EVM Wallet</div>
                                    <div className="dps-wallet-address">
                                      {walletState.address ? shortenAddress(walletState.address) : 'Not connected'}
                                    </div>
                                  </div>
                                  <div className="dps-wallet-actions">
                                    {walletConnected ? (
                                      <button type="button" onClick={disconnectWallet}>
                                        Disconnect
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={connectWallet}
                                        disabled={walletState.status === 'connecting'}
                                      >
                                        {walletState.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {!supportedPaymentNetwork && (
                                  <p className="dps-wallet-warning">
                                    This quote targets {selectedPaymentRequirements?.network}. Wallet payments currently support Base
                                    Sepolia.
                                  </p>
                                )}
                                {walletState.error && <p className="dps-wallet-error">{walletState.error}</p>}
                                <button
                                  type="button"
                                  className="dps-pay-button"
                                  onClick={handlePayInvoice}
                                  disabled={payButtonDisabled}
                                >
                                  {payButtonText}
                                </button>
                                <p className="dps-wallet-hint">
                                  Connect a wallet on Base Sepolia with enough {paymentAssetName} to complete the buy-in.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
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
