import { useEffect, useRef, useState, useCallback } from 'react';
import { DiceSimulation, DieTransform } from './physics/DiceSimulation';
import { SceneManager } from './render/SceneManager';
import { parseNotation, expandDice } from './dice/notation';
import { RollRecord, DieResult, DieSides } from './dice/types';
import { RoomClient, RoomPlayer } from './rooms/RoomClient';
import { DiceInput } from './ui/DiceInput';
import { RollHistory } from './ui/RollHistory';
import { Lobby } from './ui/Lobby';
import { PlayerList } from './ui/PlayerList';
import { DiceStatsModal } from './ui/DiceStatsModal';
import './App.css';

type AppState = 'loading' | 'idle' | 'rolling' | 'settled';
type AppView = 'lobby' | 'game';

const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL ?? 'ws://localhost:3001';
const SOLO_PASSWORD = '__solo__';

function generateSeed(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Read room code from URL hash, e.g. #IRONDICE42 */
function codeFromHash(): string | undefined {
  const hash = window.location.hash.slice(1);
  return hash.length > 0 ? hash.toUpperCase() : undefined;
}

export default function App() {
  // ─── 3D / physics refs ────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<DiceSimulation | null>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // ─── Room ref ─────────────────────────────────────────────────────────────
  const roomRef = useRef<RoomClient | null>(null);

  // ─── App state ────────────────────────────────────────────────────────────
  const [appView, setAppView] = useState<AppView>('lobby');
  const appViewRef = useRef<AppView>('lobby');
  const [appState, setAppState] = useState<AppState>('loading');
  const [history, setHistory] = useState<RollRecord[]>([]);
  const [pendingNotation, setPendingNotation] = useState('');
  const [parseError, setParseError] = useState('');
  const [lobbyError, setLobbyError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [myId, setMyId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(() => window.innerWidth > 600);

  useEffect(() => {
    const onResize = () => setSidePanelOpen(window.innerWidth > 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const currentNotationRef = useRef('');
  const currentModifierRef = useRef(0);
  const appStateRef = useRef<AppState>('loading');

  function updateAppState(s: AppState) {
    appStateRef.current = s;
    setAppState(s);
  }

  function updateAppView(v: AppView) {
    appViewRef.current = v;
    setAppView(v);
  }

  // ─── 3D engine init ────────────────────────────────────────────────────────

  useEffect(() => {
    if (appView !== 'game') return;

    let cancelled = false;
    let localRafId = 0;
    const canvas = canvasRef.current!;

    async function init() {
      const sim = await DiceSimulation.create();
      if (cancelled) { sim.dispose(); return; }

      const scene = new SceneManager(canvas);
      simRef.current = sim;
      sceneRef.current = scene;
      updateAppState('idle');
      lastTimeRef.current = performance.now();

      function loop(ts: number) {
        if (cancelled) return;
        const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.1);
        lastTimeRef.current = ts;

        sim.step(dt);
        const transforms = sim.getTransforms();
        scene.updateDice(transforms);
        scene.render();

        if (appStateRef.current === 'rolling' && sim.isAllSettled()) {
          updateAppState('settled');
          finalizeRoll(transforms);
        }

        localRafId = requestAnimationFrame(loop);
        rafRef.current = localRafId;
      }

      localRafId = requestAnimationFrame(loop);
      rafRef.current = localRafId;
    }

    init();

    function handleResize() {
      sceneRef.current?.resize(canvas.clientWidth, canvas.clientHeight);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(localRafId);
      window.removeEventListener('resize', handleResize);
      simRef.current?.dispose();
      sceneRef.current?.dispose();
      simRef.current = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appView]);

  // ─── Shared room callback builder ─────────────────────────────────────────

  function makeCommonCallbacks() {
    return {
      onConnected: (id: string) => {
        setMyId(id);
        // Update our own placeholder entry with the real socket ID
        setPlayers((prev) => prev.map((p) => (p.id === 'me' ? { ...p, id } : p)));
      },
      onPlayerJoined: (p: RoomPlayer) => {
        setPlayers((prev) => [...prev.filter((x) => x.id !== p.id), p]);
      },
      onPlayerLeft: (_id: string) => {
        setPlayers((prev) => prev.filter((p) => p.id !== _id));
      },
      onRoll: (msg: { notation: string; seed: string }) => {
        triggerRoll(msg.notation, msg.seed);
      },
      onRoomClosed: () => {
        roomRef.current = null;
        window.location.hash = '';
        setLobbyError('The host has closed the room');
        updateAppView('lobby');
        updateAppState('loading');
      },
      onDisconnected: () => {
        if (appViewRef.current === 'lobby') {
          setIsConnecting(false);
          setLobbyError('Could not reach the server — check the signal server URL');
        } else {
          setPlayers((prev) => prev.slice(0, 1));
        }
      },
    };
  }

  // ─── Lobby → Room connection ───────────────────────────────────────────────

  function enterGame(code: string, hostRole: boolean) {
    setRoomCode(code);
    setIsHost(hostRole);
    updateAppView('game');
  }

  function handleCreateRoom(code: string, name: string, password: string) {
    setLobbyError('');
    const solo = password === SOLO_PASSWORD;

    if (solo) {
      roomRef.current = null;
      setPlayers([{ id: 'solo', name, isHost: true }]);
      setMyId('solo');
      enterGame(code, true);
      return;
    }

    // Set our own placeholder entry immediately; onConnected swaps 'me' for the real ID
    setPlayers([{ id: 'me', name, isHost: true }]);

    const client = new RoomClient(SIGNAL_URL, name, {
      ...makeCommonCallbacks(),
      onRoomCreated: (c) => {
        window.location.hash = c;
      },
      onError: (reason) => {
        if (appViewRef.current === 'game') setParseError(reason);
        else setLobbyError(reason);
      },
    });

    roomRef.current = client;
    client.createRoom(code, password).catch((e: unknown) => {
      setLobbyError((e as Error).message);
    });

    enterGame(code, true);
  }

  function handleJoinRoom(code: string, name: string, password: string) {
    setLobbyError('');
    setIsConnecting(true);

    const client = new RoomClient(SIGNAL_URL, name, {
      ...makeCommonCallbacks(),
      onRoomJoined: (players) => {
        setPlayers(players);
        setIsConnecting(false);
        roomRef.current = client;
        enterGame(code, false);
      },
      onRoomRejected: (reason) => {
        setIsConnecting(false);
        setLobbyError(reason);
        client.disconnect();
      },
      onError: (reason) => {
        if (appViewRef.current === 'game') setParseError(reason);
        else { setIsConnecting(false); setLobbyError(reason); }
      },
    });

    client.joinRoom(code, password).catch((e: unknown) => {
      setIsConnecting(false);
      setLobbyError((e as Error).message);
    });
  }

  function handleLeaveRoom() {
    roomRef.current?.disconnect();
    roomRef.current = null;
    window.location.hash = '';
    setPlayers([]);
    setRoomCode('');
    setMyId('');
    updateAppView('lobby');
    updateAppState('loading');
  }

  // ─── Roll ──────────────────────────────────────────────────────────────────

  const handleRoll = useCallback((notation: string) => {
    if (appStateRef.current !== 'idle' && appStateRef.current !== 'settled') return;

    setParseError('');
    let parsed;
    try {
      parsed = parseNotation(notation);
    } catch (e) {
      setParseError((e as Error).message);
      return;
    }

    const seed = generateSeed();

    if (roomRef.current) {
      roomRef.current.broadcastRoll(seed, parsed.raw);
    }

    triggerRoll(parsed.raw, seed);
  }, []);

  /** Internal: actually start a roll given notation + seed (called by self and by peers) */
  function triggerRoll(notation: string, seed: string) {
    if (!simRef.current || !sceneRef.current) return;

    let parsed;
    try {
      parsed = parseNotation(notation);
    } catch {
      return;
    }

    const sides = expandDice(parsed);
    currentNotationRef.current = parsed.raw;
    currentModifierRef.current = parsed.modifier;
    setPendingNotation(parsed.raw);

    simRef.current.setDice(sides);
    sceneRef.current.setDice(sides);
    simRef.current.roll(seed);

    updateAppState('rolling');
  }

  const handleReset = useCallback(() => {
    simRef.current?.forceReset();
    sceneRef.current?.setDice([]);
    updateAppState('idle');
    setParseError('');
    setPendingNotation('');
  }, []);

  function finalizeRoll(transforms: DieTransform[]) {
    const raw: DieResult[] = transforms.map((t) => ({ sides: t.sides, value: t.value ?? 0 }));

    // Collapse percentile pairs (1000=tens 00-90, 1001=units 1-10) into single d100 results.
    // expandDice groups all tens before all units, so pair by index.
    const tensValues = raw.filter((d) => d.sides === 1000).map((d) => d.value);
    const unitsValues = raw.filter((d) => d.sides === 1001).map((d) => d.value);
    const others = raw.filter((d) => d.sides !== 1000 && d.sides !== 1001);
    const diceResults: DieResult[] = [
      ...tensValues.map((tv, i) => ({ sides: 100 as DieSides, value: tv + (unitsValues[i] ?? 0) })),
      ...others,
    ];

    const rawSum = diceResults.reduce((s, d) => s + d.value, 0);
    const total = rawSum + currentModifierRef.current;

    const record: RollRecord = {
      id: generateSeed(),
      notation: currentNotationRef.current,
      dice: diceResults,
      modifier: currentModifierRef.current,
      total,
      timestamp: Date.now(),
    };

    setHistory((h) => [record, ...h].slice(0, 50));
  }

  // ─── Lobby view ───────────────────────────────────────────────────────────

  if (appView === 'lobby') {
    return (
      <Lobby
        initialCode={codeFromHash()}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        error={lobbyError}
        isConnecting={isConnecting}
      />
    );
  }

  // ─── Game view ────────────────────────────────────────────────────────────

  const isRolling = appState === 'rolling';
  const latestRecord = history[0];
  const multiPlayer = players.length > 1 || (roomRef.current !== null);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="scene-canvas" />

      {appState === 'loading' && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>Loading physics engine…</p>
        </div>
      )}

      <header className="app-header">
        <span className="app-logo">⬡ Dice NG</span>
      </header>

      {parseError && (
        <div className="error-toast" onClick={() => setParseError('')}>
          {parseError}
        </div>
      )}

      {showStatsModal && <DiceStatsModal onClose={() => setShowStatsModal(false)} />}

      {appState !== 'loading' && (
        <>
          {(latestRecord || isRolling) && (
            <div className={`result-display ${appState === 'settled' ? 'result-settled' : ''}`}>
              <span className="result-notation">{pendingNotation}</span>
              <span className="result-total">{isRolling ? '…' : latestRecord?.total}</span>
              {latestRecord && latestRecord.dice.length > 1 && !isRolling && (
                <span className="result-breakdown">
                  [{latestRecord.dice.map((d) => String(d.value)).join(', ')}]
                  {latestRecord.modifier !== 0 &&
                    ` ${latestRecord.modifier > 0 ? '+' : ''}${latestRecord.modifier}`}
                </span>
              )}
              {multiPlayer && latestRecord && !isRolling && (
                <span className="result-roller">{latestRecord.notation}</span>
              )}
            </div>
          )}

          <div className={`side-panel-wrapper${sidePanelOpen ? ' open' : ''}`}>
            <button
              className="side-panel-toggle"
              onClick={() => setSidePanelOpen(o => !o)}
              aria-label={sidePanelOpen ? 'Collapse panel' : 'Expand panel'}
            >
              <span className="side-panel-toggle-icon">{sidePanelOpen ? '›' : '‹'}</span>
              <span className="side-panel-toggle-label">Roll History</span>
            </button>
            <div className="side-panel">
              {roomCode && roomCode !== 'SOLO' && (
                <PlayerList
                  players={players}
                  myId={myId}
                  roomCode={roomCode}
                  isHost={isHost}
                  onLeave={handleLeaveRoom}
                />
              )}
              {(!roomCode || roomCode === 'SOLO') && (
                <div className="solo-back">
                  <button className="leave-btn" onClick={handleLeaveRoom}>← Lobby</button>
                  <button
                    className="stats-test-btn"
                    onClick={() => setShowStatsModal(true)}
                    disabled={isRolling}
                    title="Run statistical fairness test on all die geometries"
                  >
                    Stats Test
                  </button>
                </div>
              )}
              <RollHistory records={history} onClear={() => setHistory([])} />
            </div>
          </div>

          <div className="bottom-bar">
            <DiceInput onRoll={handleRoll} disabled={isRolling} />
            <div className="bottom-status-row">
              {isRolling && <p className="rolling-hint">Rolling {pendingNotation}…</p>}
              {appState === 'settled' && <p className="settled-hint">Click Roll to go again</p>}
              {(isRolling || appState === 'settled') && (
                <button className="reset-btn" onClick={handleReset} title="Stop roll and reset">
                  Reset
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
