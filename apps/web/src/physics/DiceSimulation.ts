import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import seedrandom from 'seedrandom';
import { DieSides, DIE_COLORS } from '../dice/types';

// ─── Geometry helpers ────────────────────────────────────────────────────────

/**
 * Returns the unique outward face directions for a BufferGeometry.
 * For each group of co-planar triangles (same face on a polyhedron),
 * the centroid direction is identical — we deduplicate to get one vector per face.
 */
function uniqueFaceDirections(geo: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const dirs: THREE.Vector3[] = [];

  for (let i = 0; i < pos.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i);
    const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
    // Use face normal instead of centroid direction: co-planar triangles (same
    // polygonal face) share the same normal, so they deduplicate correctly.
    // Centroid direction fails for D10 kite faces (2 tris each) and D12
    // pentagonal faces (3 tris each), producing 20/36 directions instead of 10/12.
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    // Flip inward-pointing normals (ensure outward via centroid dot-check)
    if (normal.dot(a.clone().add(b).add(c)) < 0) normal.negate();
    if (!dirs.some((d) => d.dot(normal) > 0.99)) dirs.push(normal);
  }
  return dirs;
}

/** Generate n evenly-distributed directions on a sphere (Fibonacci lattice). */
function fibonacciSphereDirections(n: number): THREE.Vector3[] {
  const dirs: THREE.Vector3[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const phi = goldenAngle * i;
    dirs.push(new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi)));
  }
  return dirs;
}

/** Build a pentagonal trapezohedron (D10) BufferGeometry. */
function buildD10Geometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const TAU = Math.PI * 2;
  const step = TAU / 5;

  const top = new THREE.Vector3(0, 1, 0);
  const bot = new THREE.Vector3(0, -1, 0);
  const upper: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];

  for (let i = 0; i < 5; i++) {
    upper.push(new THREE.Vector3(Math.cos(i * step) * 0.9, 0.1, Math.sin(i * step) * 0.9));
    lower.push(
      new THREE.Vector3(
        Math.cos(i * step + step / 2) * 0.9,
        -0.1,
        Math.sin(i * step + step / 2) * 0.9
      )
    );
  }

  function tri(p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) {
    positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
  }

  for (let k = 0; k < 5; k++) {
    const u0 = upper[k];
    const u1 = upper[(k + 1) % 5];
    const l0 = lower[k];
    const l1 = lower[(k + 1) % 5];

    // Upper kite: top, lower[k], upper[k]  +  top, upper[(k+1)%5], lower[k]
    tri(top, l0, u0);
    tri(top, u1, l0);

    // Lower kite: bot, upper[(k+1)%5], lower[(k+1)%5]  +  bot, lower[k], upper[(k+1)%5]
    tri(bot, u1, l1);
    tri(bot, l0, u1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// ─── Per-die type configuration ──────────────────────────────────────────────

interface DieConfig {
  geo: THREE.BufferGeometry;
  faceDirections: THREE.Vector3[];
  faceValues: number[];
  hullPoints: Float32Array;
  color: number;
}

function buildDieConfig(sides: DieSides): DieConfig {
  const color = DIE_COLORS[sides];

  if (sides === 100) {
    // Zocchihedron: sphere mesh + 100 Fibonacci-distributed face directions
    const geo = new THREE.SphereGeometry(0.72, 16, 12);
    const faceDirections = fibonacciSphereDirections(100);
    faceDirections.sort((a, b) => {
      const dy = b.y - a.y;
      if (Math.abs(dy) > 0.01) return dy;
      return Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x);
    });
    const faceValues = faceDirections.map((_, i) => i + 1);
    const pos = geo.getAttribute('position').array as Float32Array;
    return { geo, faceDirections, faceValues, hullPoints: pos, color };
  }

  if (sides === 6) {
    // Cube: hardcode canonical face directions so values match real die layout
    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const faceDirections = [
      new THREE.Vector3(0, 1, 0),   // +Y
      new THREE.Vector3(0, -1, 0),  // -Y
      new THREE.Vector3(1, 0, 0),   // +X
      new THREE.Vector3(-1, 0, 0),  // -X
      new THREE.Vector3(0, 0, 1),   // +Z
      new THREE.Vector3(0, 0, -1),  // -Z
    ];
    const faceValues = [1, 6, 3, 4, 2, 5];
    const pos = geo.getAttribute('position').array as Float32Array;
    return { geo, faceDirections, faceValues, hullPoints: pos, color };
  }

  let geo: THREE.BufferGeometry;
  switch (sides) {
    case 4:   geo = new THREE.TetrahedronGeometry(0.75); break;
    case 8:   geo = new THREE.OctahedronGeometry(0.7); break;
    case 10:  geo = buildD10Geometry(); break;
    case 12:  geo = new THREE.DodecahedronGeometry(0.72); break;
    case 20:  geo = new THREE.IcosahedronGeometry(0.76); break;
    default:  geo = new THREE.SphereGeometry(0.5, 8, 8);
  }

  const faceDirections = uniqueFaceDirections(geo);

  // Sort directions by descending Y then azimuth for a deterministic value order
  faceDirections.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 0.01) return dy;
    return Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x);
  });

  const faceValues = faceDirections.map((_, i) => i + 1);
  const pos = geo.getAttribute('position').array as Float32Array;

  return { geo, faceDirections, faceValues, hullPoints: pos, color };
}

// Lazily built, shared across all instances of the same die type
const CONFIG_CACHE = new Map<DieSides, DieConfig>();

function getDieConfig(sides: DieSides): DieConfig {
  if (!CONFIG_CACHE.has(sides)) CONFIG_CACHE.set(sides, buildDieConfig(sides));
  return CONFIG_CACHE.get(sides)!;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DieTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  settled: boolean;
  value: number | undefined;
  sides: DieSides;
}

// ─── Simulation class ─────────────────────────────────────────────────────────

interface SimDie {
  sides: DieSides;
  body: RAPIER.RigidBody;
  config: DieConfig;
}


const GRAVITY = -25;
const FIXED_STEP = 1 / 60;
const SETTLE_DELAY = 0.5;   // seconds after roll before we check settle
const MAX_ROLL_TIME = 9;    // hard timeout: force-stop after this many sim-seconds
const PLAY_HALF = 4.5;      // half-size of playable area (dice spawn within ±PLAY_HALF)

export class DiceSimulation {
  private world: RAPIER.World;
  private dice: SimDie[] = [];
  private accumulator = 0;
  private rollTime = -1;
  private simTime = 0;
  private forceSettled = false;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  static async create(): Promise<DiceSimulation> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = FIXED_STEP;

    const sim = new DiceSimulation(world);
    sim.buildArena();
    return sim;
  }

  private buildArena() {
    const W = PLAY_HALF;  // 4.5
    const T = 0.5;        // wall half-thickness
    const H = 7.5;        // wall half-height → walls span y = 0..15

    // Floor (slightly larger than play area)
    const floor = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(W + T, 0.1, W + T)
        .setRestitution(0.25)
        .setFriction(0.85),
      floor
    );

    // Four walls: X-walls extend full Z span (including corners) to close the box
    const walls: [number, number, number, number, number, number][] = [
      //  bx          by  bz          hx    hy  hz
      [  W + T,       H,  0,          T,    H,  W + T * 2 ],  // +X
      [-(W + T),      H,  0,          T,    H,  W + T * 2 ],  // -X
      [  0,           H,  W + T,      W,    H,  T         ],  // +Z
      [  0,           H, -(W + T),    W,    H,  T         ],  // -Z
    ];

    for (const [bx, by, bz, hx, hy, hz] of walls) {
      const wb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(bx, by, bz));
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.15).setFriction(0.9),
        wb
      );
    }

    // Roof — absolute last resort for any die that still manages to go very high
    const roofY = H * 2 - 0.5;
    const roof = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, roofY, 0));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(W + T, 0.1, W + T)
        .setRestitution(0.05)
        .setFriction(0.9),
      roof
    );
  }

  // ─── Die management ─────────────────────────────────────────────────────────

  setDice(sides: DieSides[]) {
    for (const d of this.dice) this.world.removeRigidBody(d.body);
    this.dice = [];

    for (const s of sides) {
      const config = getDieConfig(s);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(0, 5, 0)
          .setLinearDamping(0.2)
          .setAngularDamping(0.4)
      );

      let collider: RAPIER.ColliderDesc;
      if (s === 6) {
        collider = RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4);
      } else if (s === 100) {
        collider = RAPIER.ColliderDesc.ball(0.72);
      } else {
        collider = RAPIER.ColliderDesc.convexHull(config.hullPoints) ?? RAPIER.ColliderDesc.ball(0.5);
      }
      collider.setRestitution(0.4).setFriction(0.6);
      this.world.createCollider(collider, body);

      this.dice.push({ sides: s, body, config });
    }
  }

  // ─── Rolling ────────────────────────────────────────────────────────────────

  roll(seed: string) {
    const rng = seedrandom(seed);
    this.rollTime = this.simTime;
    this.forceSettled = false;

    // Spread capped so dice never start outside the play area
    const spread = Math.min(1.0 + this.dice.length * 0.25, 3.0);

    for (const die of this.dice) {
      const x = (rng() - 0.5) * spread * 2;
      const z = (rng() - 0.5) * spread * 2;
      // Keep spawn height low: max y-velocity + gravity means max apex ~3.5 m,
      // well below the wall top at y=8
      die.body.setTranslation({ x, y: 1.5 + rng() * 0.5, z }, true);

      die.body.setRotation(randomUnitQuaternion(rng), true);
      die.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      die.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      die.body.wakeUp();

      // Horizontal impulse limited so total travel stays within PLAY_HALF
      die.body.applyImpulse(
        {
          x: (rng() - 0.5) * 3,
          y: 2 + rng() * 2,   // y: 2–4 m/s → apex ≈ y_start + 0.32 = 1.8–2.3 m
          z: (rng() - 0.5) * 3,
        },
        true
      );
      die.body.applyTorqueImpulse(
        {
          x: (rng() - 0.5) * 10,
          y: (rng() - 0.5) * 10,
          z: (rng() - 0.5) * 10,
        },
        true
      );
    }
  }

  // ─── Stepping ───────────────────────────────────────────────────────────────

  step(dtSeconds: number) {
    this.accumulator += Math.min(dtSeconds, 0.1);
    while (this.accumulator >= FIXED_STEP) {
      this.world.step();
      this.simTime += FIXED_STEP;
      this.accumulator -= FIXED_STEP;
    }

    // Hard timeout: if a die got stuck or escaped, force-stop everything
    if (
      this.rollTime >= 0 &&
      !this.forceSettled &&
      this.simTime - this.rollTime > MAX_ROLL_TIME
    ) {
      this.forceSettled = true;
      for (const d of this.dice) {
        d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        d.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  // ─── State readout ──────────────────────────────────────────────────────────

  getTransforms(): DieTransform[] {
    const timeSinceRoll = this.simTime - this.rollTime;
    return this.dice.map((d) => {
      const t = d.body.translation();
      const r = d.body.rotation();
      // Rapier's sleep detection is more reliable than a manual velocity threshold
      const settled =
        this.rollTime >= 0 &&
        timeSinceRoll > SETTLE_DELAY &&
        (this.forceSettled || d.body.isSleeping());

      return {
        position: new THREE.Vector3(t.x, t.y, t.z),
        quaternion: new THREE.Quaternion(r.x, r.y, r.z, r.w),
        settled,
        value: settled ? this.readFaceUp(d) : undefined,
        sides: d.sides,
      };
    });
  }

  isAllSettled(): boolean {
    if (this.rollTime < 0 || this.dice.length === 0) return false;
    if (this.forceSettled) return true;
    const timeSinceRoll = this.simTime - this.rollTime;
    if (timeSinceRoll <= SETTLE_DELAY) return false;
    return this.dice.every((d) => d.body.isSleeping());
  }

  /** Kill switch: stop any ongoing roll and clear dice immediately. */
  forceReset() {
    for (const d of this.dice) this.world.removeRigidBody(d.body);
    this.dice = [];
    this.rollTime = -1;
    this.forceSettled = false;
  }

  private readFaceUp(d: SimDie): number {
    const r = d.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const up = new THREE.Vector3(0, 1, 0);

    let best = -Infinity;
    let bestIdx = 0;
    for (let i = 0; i < d.config.faceDirections.length; i++) {
      const dot = d.config.faceDirections[i].clone().applyQuaternion(q).dot(up);
      if (dot > best) {
        best = dot;
        bestIdx = i;
      }
    }
    return d.config.faceValues[bestIdx];
  }

  dispose() {
    this.world.free();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomUnitQuaternion(rng: () => number): {
  x: number;
  y: number;
  z: number;
  w: number;
} {
  // Shoemake's method for uniform random quaternion
  const u1 = rng();
  const u2 = rng() * Math.PI * 2;
  const u3 = rng() * Math.PI * 2;
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  return {
    x: s1 * Math.sin(u2),
    y: s1 * Math.cos(u2),
    z: s2 * Math.sin(u3),
    w: s2 * Math.cos(u3),
  };
}

export { getDieConfig };
