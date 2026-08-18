# Dice NG

Physics-based dice roller with real-time multiplayer rooms. Roll dice in 3D and share results with your table — everyone sees the same throw.

![React](https://img.shields.io/badge/React-18-blue) ![Three.js](https://img.shields.io/badge/Three.js-r168-black) ![Rapier](https://img.shields.io/badge/Rapier-0.12-orange) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

---

## Features

- **3D physics simulation** — dice tumble, bounce, and settle using [Rapier](https://rapier.rs/) (WebAssembly). Each roll is deterministic: the same seed produces the same result on every client.
- **Supported dice** — D4, D6, D8, D10, D12, D20, D100 (percentile pair), D100z (Zocchihedron sphere), plus bonus D1, D2 (coin), and D3.
- **Standard notation** — `2d6`, `d20+5`, `4d6`, `d100`, `d100z`, modifiers, up to 100 dice.
- **Multiplayer rooms** — create a password-protected room, share the code (or the URL hash link), and rolls are broadcast live to every player.
- **Solo mode** — skip the lobby and roll immediately without a server connection.
- **Roll history** — last 50 rolls, with per-die breakdown and totals.
- **Fairness test** — built-in chi-squared statistical test (27 500 headless rolls) to verify all die geometries are physically fair.
- **Responsive** — side panel collapses on mobile; camera is fully orbiteable.

---

## How it works

### Architecture

```
monorepo (npm workspaces)
├── apps/web       React + Vite frontend
│   ├── physics/   Rapier3D simulation (WASM)
│   ├── render/    Three.js scene & face textures
│   ├── dice/      Notation parser & die types
│   ├── rooms/     WebSocket room client
│   └── ui/        Lobby, DiceInput, PlayerList, History, Stats
└── apps/signal    Node.js WebSocket signaling server
```

### Roll flow

1. A player enters a notation (e.g. `2d6+3`) and clicks **Roll**.
2. The client generates a random seed (`Date.now() + Math.random()`).
3. If in a room, the `{notation, seed}` pair is broadcast to all peers via the signal server.
4. Every client (including the sender) calls `DiceSimulation.roll(seed)` — the seeded RNG ensures identical physics across all machines.
5. Once all dice sleep, `readFaceUp()` reads the result:
   - **Face-top dice** (D6, D8, D12, D20): argmax of face-normal dot world-up.
   - **Vertex-top dice** (D4): argmin — the bottom face is flat on the table, and its pre-assigned value equals the opposite (top) vertex.
   - **D2 (coin)**: same argmax as the other face-top dice, but which face starts face-up is drawn 50/50 from the seed before every throw — this cancels out any physical landing bias the physics has (a "memory" of its start face, or the opposite) without needing to fix the result independently of physics.
6. Results are pushed to the roll history panel.

### Multiplayer rooms

The signal server (`apps/signal`) is a lightweight WebSocket relay. It holds no game state beyond room membership:

| Message | Direction | Description |
|---|---|---|
| `WELCOME` | S→C | Assigns a socket ID |
| `CREATE_ROOM` | C→S | Creates a password-protected room |
| `JOIN_ROOM` | C→S | Joins an existing room |
| `ROLL` | C→S→C | Relays `{notation, seed}` to all other room members |
| `PLAYER_JOINED / LEFT` | S→C | Roster updates |
| `ROOM_CLOSED` | S→C | Sent when the host disconnects |

Passwords are hashed with SHA-256 (Web Crypto API) client-side before being sent.

Room codes appear in the URL hash (`example.com/#IRONDICE42`) so you can share a direct join link.

---

## Getting started

### Prerequisites

- Node.js 18+
- npm 9+

### Development

```bash
# Install all workspace dependencies
npm install

# Start the Vite dev server (frontend)
npm run dev

# Start the signal server (multiplayer)
npm run dev:signal
```

The frontend defaults to `ws://localhost:3001` for the signal server. Override with `VITE_SIGNAL_URL` in `.env.local`:

```
VITE_SIGNAL_URL=wss://your-server.example.com
```

### Production build

```bash
npm run build
# Output: apps/signal/dist  +  apps/web/dist
```

### Docker (signal server)

```bash
docker compose up -d
```

The signal server listens on `127.0.0.1:3001` by default (loopback-only, intended for a reverse proxy). See `docker-compose.yml` for the health-check configuration.

---

## Project structure

```
apps/web/src/
├── App.tsx                 Root component — state, room lifecycle, roll dispatch
├── dice/
│   ├── types.ts            Die sides, colors, notation types
│   └── notation.ts         Notation parser (2d6+3, d100, d100z…)
├── physics/
│   └── DiceSimulation.ts   Rapier world, geometry builders, seeded roll, face readout
├── render/
│   └── SceneManager.ts     Three.js scene, per-face canvas textures, OrbitControls
├── rooms/
│   └── RoomClient.ts       WebSocket client, room code generator
└── ui/
    ├── Lobby.tsx           Create / Join room forms
    ├── DiceInput.tsx       Die buttons + notation text input + presets
    ├── PlayerList.tsx      Room roster with leave button
    ├── RollHistory.tsx     Scrollable roll log
    └── DiceStatsModal.tsx  Chi-squared fairness tester

apps/signal/src/
└── index.ts                WebSocket server — rooms, broadcast, heartbeat
```

---

## Die geometry notes

| Die | Shape | Collider | Result detection |
|-----|-------|----------|-----------------|
| D4  | Tetrahedron | Convex hull | Bottom face (argmin) |
| D6  | Cube | Cuboid | Top face (argmax) |
| D8  | Octahedron | Convex hull | Top face |
| D10 | Pentagonal trapezohedron (custom) | Convex hull | Top face |
| D12 | Dodecahedron | Convex hull | Top face |
| D20 | Icosahedron | Convex hull | Top face |
| D100 | Two D10s (tens 00–90 + units 1–10) | Convex hull | Paired & summed |
| D100z | Sphere (Zocchihedron) | Ball | Top face (Fibonacci distribution) |
| D2  | Thin cylinder coin | Cylinder | Seeded RNG (physics too biased) |

Each die geometry gets per-face UV groups and Canvas-rendered numbered textures. D4 uses a rotated three-corner layout (the traditional "read the bottom vertex" convention).

---

## License

MIT — see [LICENSE](LICENSE).
