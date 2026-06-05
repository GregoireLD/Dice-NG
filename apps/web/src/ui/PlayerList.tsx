import { useState } from 'react';
import { RoomPlayer } from '../rooms/RoomClient';

interface PlayerListProps {
  players: RoomPlayer[];
  myId: string;
  roomCode: string;
  isHost: boolean;
  onLeave: () => void;
}

const PLAYER_COLORS = ['#7c5cbf', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#f97316'];

function colorForIndex(i: number): string {
  return PLAYER_COLORS[i % PLAYER_COLORS.length];
}

export function PlayerList({ players, myId, roomCode, isHost, onLeave }: PlayerListProps) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="player-panel">
      <div className="player-panel-header">
        <div className="room-code-row">
          <span className="room-code">{roomCode}</span>
          <button className="copy-link-btn" onClick={copyLink} title="Copy invite link">
            {copied ? '✓ Copied' : '⎘ Link'}
          </button>
        </div>
        {isHost && <span className="host-badge">Host</span>}
      </div>

      <ul className="player-list">
        {players.map((p, i) => (
          <li key={p.id} className="player-item">
            <span
              className="player-dot"
              style={{ background: colorForIndex(i) }}
            />
            <span className="player-name">
              {p.name}
              {p.id === myId && <span className="you-tag"> (you)</span>}
              {p.isHost && <span className="host-tag"> ★</span>}
            </span>
          </li>
        ))}
      </ul>

      <button className="leave-btn" onClick={onLeave}>
        Leave room
      </button>
    </div>
  );
}
