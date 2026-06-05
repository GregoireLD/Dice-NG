import { createServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Room {
  code: string;
  hostId: string;
  passwordHash: string;
  players: Map<string, string>; // socketId → displayName (includes host)
}

type ClientMsg =
  | { type: 'CREATE_ROOM'; roomCode: string; passwordHash: string; playerName: string }
  | { type: 'JOIN_ROOM'; roomCode: string; passwordHash: string; playerName: string }
  | { type: 'ROLL'; notation: string; seed: string }
  | { type: 'LEAVE' };

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

// ─── State ────────────────────────────────────────────────────────────────────

const sockets = new Map<string, WebSocket>();
const rooms = new Map<string, Room>();        // roomCode → Room
const playerRoom = new Map<string, string>(); // socketId → roomCode

function genId(): string {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendTo(id: string, msg: ServerMsg) {
  const ws = sockets.get(id);
  if (ws) send(ws, msg);
}

/** Send to all players in the room, optionally skipping one sender */
function broadcast(room: Room, msg: ServerMsg, excludeId?: string) {
  for (const id of room.players.keys()) {
    if (id !== excludeId) sendTo(id, msg);
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function onDisconnect(id: string) {
  sockets.delete(id);

  const code = playerRoom.get(id);
  playerRoom.delete(id);
  if (!code) return;

  const room = rooms.get(code);
  if (!room) return;

  const name = room.players.get(id) ?? id;
  room.players.delete(id);

  if (room.hostId === id) {
    // Host left — close room and tell everyone
    broadcast(room, { type: 'ROOM_CLOSED' });
    rooms.delete(code);
    console.log(`Room ${code} closed (host left)`);
  } else {
    broadcast(room, { type: 'PLAYER_LEFT', id, name });
    if (room.players.size === 0) {
      rooms.delete(code);
      console.log(`Room ${code} closed (empty)`);
    }
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

function handle(id: string, ws: WebSocket, raw: string) {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw) as ClientMsg;
  } catch {
    return;
  }

  switch (msg.type) {
    case 'CREATE_ROOM': {
      const code = msg.roomCode.toUpperCase();
      if (rooms.has(code)) {
        send(ws, { type: 'ERROR', reason: `Room ${code} already exists` });
        break;
      }
      const room: Room = {
        code,
        hostId: id,
        passwordHash: msg.passwordHash,
        players: new Map([[id, msg.playerName]]), // host is the first player
      };
      rooms.set(code, room);
      playerRoom.set(id, code);
      send(ws, { type: 'ROOM_CREATED', roomCode: code });
      console.log(`Room ${code} created by ${msg.playerName}`);
      break;
    }

    case 'JOIN_ROOM': {
      const code = msg.roomCode.toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        send(ws, { type: 'ROOM_REJECTED', reason: 'Room not found' });
        break;
      }
      if (msg.passwordHash !== room.passwordHash) {
        send(ws, { type: 'ROOM_REJECTED', reason: 'Wrong password' });
        break;
      }
      room.players.set(id, msg.playerName);
      playerRoom.set(id, code);

      // Send the full current player list to the new joiner
      const players = Array.from(room.players.entries()).map(([pid, name]) => ({ id: pid, name }));
      send(ws, { type: 'ROOM_JOINED', roomCode: code, hostId: room.hostId, players });

      // Notify everyone else that a new player joined
      broadcast(room, { type: 'PLAYER_JOINED', id, name: msg.playerName }, id);
      console.log(`${msg.playerName} joined room ${code}`);
      break;
    }

    case 'ROLL': {
      const code = playerRoom.get(id);
      if (!code) break;
      const room = rooms.get(code);
      if (!room) break;
      const playerName = room.players.get(id) ?? id;
      // Relay to everyone else in the room; sender plays the roll locally
      broadcast(room, { type: 'ROLL', fromId: id, playerName, notation: msg.notation, seed: msg.seed }, id);
      break;
    }

    case 'LEAVE': {
      onDisconnect(id);
      break;
    }
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const httpServer = createServer((req: IncomingMessage, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const id = genId();
  sockets.set(id, ws);
  send(ws, { type: 'WELCOME', id });

  ws.on('message', (raw) => handle(id, ws, raw.toString()));
  ws.on('close', () => onDisconnect(id));
  ws.on('error', () => onDisconnect(id));
});

httpServer.listen(PORT, () => {
  console.log(`Signal server listening on :${PORT}`);
});
