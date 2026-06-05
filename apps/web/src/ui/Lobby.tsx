import { useState, useEffect } from 'react';
import { generateRoomCode } from '../rooms/RoomClient';

interface LobbyProps {
  initialCode?: string; // pre-filled from URL hash
  onCreateRoom: (code: string, name: string, password: string) => void;
  onJoinRoom: (code: string, name: string, password: string) => void;
  error?: string;
  isConnecting?: boolean;
}

type Tab = 'create' | 'join';

export function Lobby({ initialCode, onCreateRoom, onJoinRoom, error, isConnecting }: LobbyProps) {
  const [tab, setTab] = useState<Tab>(initialCode ? 'join' : 'create');
  const [name, setName] = useState(() => localStorage.getItem('dice-ng:name') ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(initialCode ?? generateRoomCode());

  // If a URL hash code arrives, switch to join tab
  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      setTab('join');
    }
  }, [initialCode]);

  function persistName(n: string) {
    setName(n);
    localStorage.setItem('dice-ng:name', n);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim() || !password.trim()) return;
    onCreateRoom(code.trim().toUpperCase(), name.trim(), password);
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim() || !password.trim()) return;
    onJoinRoom(code.trim().toUpperCase(), name.trim(), password);
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="lobby-title">⬡ Dice NG</h1>
        <p className="lobby-subtitle">Physics-based dice rolling — shared in real time</p>

        <div className="lobby-tabs">
          <button
            className={`lobby-tab ${tab === 'create' ? 'active' : ''}`}
            onClick={() => setTab('create')}
          >
            Create Room
          </button>
          <button
            className={`lobby-tab ${tab === 'join' ? 'active' : ''}`}
            onClick={() => setTab('join')}
          >
            Join Room
          </button>
        </div>

        {tab === 'create' ? (
          <form className="lobby-form" onSubmit={handleCreate}>
            <label className="field-label">Your name</label>
            <input
              className="lobby-input"
              placeholder="Gandalf"
              value={name}
              onChange={(e) => persistName(e.target.value)}
              maxLength={24}
              required
            />

            <label className="field-label">Room code</label>
            <div className="code-row">
              <input
                className="lobby-input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={16}
                required
                spellCheck={false}
              />
              <button
                type="button"
                className="refresh-btn"
                onClick={() => setCode(generateRoomCode())}
                title="Generate new code"
              >
                ↺
              </button>
            </div>

            <label className="field-label">Room password</label>
            <input
              className="lobby-input"
              type="password"
              placeholder="Share with players"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && <p className="lobby-error">{error}</p>}

            <button className="lobby-btn" type="submit">
              Create &amp; Host
            </button>
          </form>
        ) : (
          <form className="lobby-form" onSubmit={handleJoin}>
            <label className="field-label">Your name</label>
            <input
              className="lobby-input"
              placeholder="Gandalf"
              value={name}
              onChange={(e) => persistName(e.target.value)}
              maxLength={24}
              required
            />

            <label className="field-label">Room code</label>
            <input
              className="lobby-input"
              placeholder="IRONDICE42"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={16}
              required
              spellCheck={false}
            />

            <label className="field-label">Password</label>
            <input
              className="lobby-input"
              type="password"
              placeholder="Ask the host"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && <p className="lobby-error">{error}</p>}

            <button className="lobby-btn" type="submit" disabled={isConnecting}>
              {isConnecting ? 'Connecting…' : 'Join Room'}
            </button>
          </form>
        )}

        <p className="solo-hint">
          Just want to roll solo?{' '}
          <button className="link-btn" onClick={() => onCreateRoom('SOLO', name.trim() || 'You', '__solo__')}>
            Skip to solo mode
          </button>
        </p>
      </div>
    </div>
  );
}
