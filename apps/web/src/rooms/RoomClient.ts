// ─── Types ────────────────────────────────────────────────────────────────────

type ServerMsg =
  | { type: 'WELCOME'; id: string }
  | { type: 'ROOM_CREATED'; roomCode: string }
  | { type: 'ROOM_JOINED'; roomCode: string; hostId: string; players: Array<{ id: string; name: string }> }
  | { type: 'ROOM_REJECTED'; reason: string }
  | { type: 'ROOM_CLOSED' }
  | { type: 'PLAYER_JOINED'; id: string; name: string }
  | { type: 'PLAYER_LEFT'; id: string; name: string }
  | { type: 'ROLL'; fromId: string; playerName: string; notation: string; seed: string }
  | { type: 'ERROR'; reason: string };

type ClientMsg =
  | { type: 'CREATE_ROOM'; roomCode: string; passwordHash: string; playerName: string }
  | { type: 'JOIN_ROOM'; roomCode: string; passwordHash: string; playerName: string }
  | { type: 'ROLL'; notation: string; seed: string }
  | { type: 'LEAVE' };

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RoomPlayer {
  id: string;
  name: string;
  isHost: boolean;
}

export interface RollMsg {
  fromId: string;
  playerName: string;
  notation: string;
  seed: string;
}

export interface RoomCallbacks {
  onConnected?: (id: string) => void;
  onRoomCreated?: (code: string) => void;
  onRoomJoined?: (players: RoomPlayer[]) => void;
  onRoomRejected?: (reason: string) => void;
  onRoomClosed?: () => void;
  onPlayerJoined?: (player: RoomPlayer) => void;
  onPlayerLeft?: (id: string, name: string) => void;
  onRoll?: (msg: RollMsg) => void;
  onError?: (reason: string) => void;
  onDisconnected?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── RoomClient ───────────────────────────────────────────────────────────────

export class RoomClient {
  private ws: WebSocket;
  private _wsReady = false;
  private _msgQueue: ClientMsg[] = [];

  private _myId = '';
  private _myName: string;
  private _players: RoomPlayer[] = [];

  private cb: RoomCallbacks;

  constructor(serverUrl: string, playerName: string, callbacks: RoomCallbacks) {
    this._myName = playerName;
    this.cb = callbacks;

    this.ws = new WebSocket(serverUrl);

    this.ws.addEventListener('open', () => {
      this._wsReady = true;
      for (const m of this._msgQueue) this.ws.send(JSON.stringify(m));
      this._msgQueue = [];
    });

    this.ws.addEventListener('message', (ev) => {
      this.handleServerMsg(JSON.parse(ev.data as string) as ServerMsg);
    });

    this.ws.addEventListener('close', () => this.cb.onDisconnected?.());
    this.ws.addEventListener('error', () => {
      // 'close' always follows 'error' in browsers; onDisconnected handles cleanup
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  get myId() { return this._myId; }
  get players(): RoomPlayer[] { return [...this._players]; }

  async createRoom(code: string, password: string) {
    const hash = await sha256(password);
    this.wsSend({ type: 'CREATE_ROOM', roomCode: code.toUpperCase(), passwordHash: hash, playerName: this._myName });
  }

  async joinRoom(code: string, password: string) {
    const hash = await sha256(password);
    this.wsSend({ type: 'JOIN_ROOM', roomCode: code.toUpperCase(), passwordHash: hash, playerName: this._myName });
  }

  broadcastRoll(seed: string, notation: string) {
    this.wsSend({ type: 'ROLL', notation, seed });
  }

  disconnect() {
    this.wsSend({ type: 'LEAVE' });
    this.ws.close();
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private wsSend(msg: ClientMsg) {
    if (this._wsReady) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this._msgQueue.push(msg);
    }
  }

  private handleServerMsg(msg: ServerMsg) {
    switch (msg.type) {
      case 'WELCOME':
        this._myId = msg.id;
        this.cb.onConnected?.(msg.id);
        break;

      case 'ROOM_CREATED':
        this.cb.onRoomCreated?.(msg.roomCode);
        break;

      case 'ROOM_JOINED': {
        // Build player list — mark the host
        this._players = msg.players.map((p) => ({
          id: p.id,
          name: p.name,
          isHost: p.id === msg.hostId,
        }));
        // Add self (host not in the players list sent by server for joiners)
        if (!this._players.some((p) => p.id === this._myId)) {
          this._players.push({ id: this._myId, name: this._myName, isHost: false });
        }
        this.cb.onRoomJoined?.(this._players);
        break;
      }

      case 'ROOM_REJECTED':
        this.cb.onRoomRejected?.(msg.reason);
        break;

      case 'ROOM_CLOSED':
        this.cb.onRoomClosed?.();
        break;

      case 'PLAYER_JOINED': {
        const player: RoomPlayer = { id: msg.id, name: msg.name, isHost: false };
        this._players = [...this._players.filter((p) => p.id !== msg.id), player];
        this.cb.onPlayerJoined?.(player);
        break;
      }

      case 'PLAYER_LEFT':
        this._players = this._players.filter((p) => p.id !== msg.id);
        this.cb.onPlayerLeft?.(msg.id, msg.name);
        break;

      case 'ROLL':
        this.cb.onRoll?.(msg);
        break;

      case 'ERROR':
        this.cb.onError?.(msg.reason);
        break;
    }
  }
}

// ─── Room code generator ─────────────────────────────────────────────────────

const ADJECTIVES = ['IRON','GOLD','DARK','WILD','BOLD','KEEN','FAST','WISE'];
const NOUNS = ['WOLF','BEAR','HAWK','LION','CROW','DICE','MAGE','RUNE'];

export function generateRoomCode(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 90 + 10);
  return `${adj}${noun}${num}`;
}
