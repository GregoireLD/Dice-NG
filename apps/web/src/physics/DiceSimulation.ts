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

// ─── Face group / UV helpers ─────────────────────────────────────────────────

/**
 * Groups each face's triangles into geometry groups and assigns per-face planar
 * UV coordinates so each face can have its own material (numbered texture).
 * Mutates geo in place.
 */
function applyFaceGroupsAndUVs(
  geo: THREE.BufferGeometry,
  faceDirections: THREE.Vector3[]
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const numTris = pos.count / 3;

  // Cluster each triangle to the nearest face direction
  const faceTris: number[][] = faceDirections.map(() => []);
  for (let i = 0; i < numTris; i++) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i * 3);
    const b = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 2);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (normal.dot(a.clone().add(b).add(c)) < 0) normal.negate();
    const fi = faceDirections.findIndex((d) => d.dot(normal) > 0.99);
    if (fi >= 0) faceTris[fi].push(i);
  }

  const newPos: number[] = [];
  const newUV: number[] = [];
  let groupStart = 0;

  for (let fi = 0; fi < faceDirections.length; fi++) {
    const tris = faceTris[fi];
    const n = faceDirections[fi].clone().normalize();

    // Use the first triangle's first edge as the U-axis so UV winding is always
    // CCW (consistent with the outward face normal) — avoids mirrored numbers.
    const ti0 = tris[0];
    const edgeA = new THREE.Vector3().fromBufferAttribute(pos, ti0 * 3);
    const edgeB = new THREE.Vector3().fromBufferAttribute(pos, ti0 * 3 + 1);
    const t = edgeB.clone().sub(edgeA).normalize();
    const bt = new THREE.Vector3().crossVectors(n, t).normalize();

    // Collect all vertices and project to the face's 2-D plane
    const verts: THREE.Vector3[] = [];
    for (const ti of tris) {
      for (let vi = 0; vi < 3; vi++) {
        verts.push(new THREE.Vector3().fromBufferAttribute(pos, ti * 3 + vi));
      }
    }
    const us = verts.map((v) => v.dot(t));
    const vs = verts.map((v) => v.dot(bt));

    // Center UVs at the face centroid so the canvas center aligns with the face
    // center, then scale by circumradius so the face fills [pad, 1-pad]².
    const centU = us.reduce((a, b) => a + b, 0) / us.length;
    const centV = vs.reduce((a, b) => a + b, 0) / vs.length;
    const circumR = Math.max(...us.map((u, k) => Math.hypot(u - centU, vs[k] - centV)));
    const pad = 0.1;
    const scale = (0.5 - pad) / circumR;

    for (let k = 0; k < verts.length; k++) {
      newPos.push(verts[k].x, verts[k].y, verts[k].z);
      newUV.push(0.5 + (us[k] - centU) * scale, 0.5 + (vs[k] - centV) * scale);
    }

    geo.addGroup(groupStart, tris.length * 3, fi);
    groupStart += tris.length * 3;
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(newUV, 2));
  geo.computeVertexNormals();
}

// ─── Per-die type configuration ──────────────────────────────────────────────

export interface FaceCornerData {
  values: [number, number, number];
  /** UV coords [u,v] for each of the 3 corners, in the same vertex order as the triangle. */
  uvs: [[number, number], [number, number], [number, number]];
}

interface DieConfig {
  geo: THREE.BufferGeometry;
  faceDirections: THREE.Vector3[];
  faceValues: number[];
  /** Face value for each material group index (matches geo.groups order). */
  materialFaceValues: number[];
  hullPoints: Float32Array;
  color: number;
  /** Set for vertex-up dice (D4): per-face corner values and UV positions. */
  faceCornerData?: FaceCornerData[];
}

/**
 * Returns the unique vertices of a BufferGeometry (handles repeated positions).
 * Uses exact floating-point comparison scaled to the geometry — no fixed threshold.
 */
function uniqueVertices(geo: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const verts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    if (!verts.some((u) => u.distanceTo(v) < 1e-10 * (u.length() + 1))) verts.push(v);
  }
  return verts;
}

/**
 * For a convex polyhedron face whose outward normal is `faceDir`, returns the
 * vertices that form the "top feature" when that face rests on the table.
 *
 * DESIGN NOTE — why this is exact and general:
 *   We project every vertex onto faceDir (a simple dot product) and collect those
 *   at the strict minimum.  No angle threshold, no raycasting.  The minimum is
 *   always well-defined because we have a finite list of vertices.
 *
 *   The count of minimum-projection vertices tells us the topological feature type:
 *     1 vertex  → vertex-top  (D4 tetrahedron — self-dual: each face is opposite
 *                               exactly one vertex)
 *     2 vertices → edge-top   (unusual for standard dice)
 *     3+ vertices → face-top  (D6, D8, D12, D20 — opposite face has ≥3 vertices)
 *
 *   This is the support function of the polar dual evaluated at -faceDir.
 *   Euler's V − E + F = 2 guarantees the topology is internally consistent, but
 *   the projection method is what identifies which feature sits at the top.
 */
function topFeatureVerts(faceDir: THREE.Vector3, verts: THREE.Vector3[]): THREE.Vector3[] {
  const projs = verts.map((v) => v.dot(faceDir));
  const minProj = Math.min(...projs);
  // Tolerance is relative to the spread across the whole polyhedron — no magic constant.
  const spread = Math.max(...projs) - minProj;
  const eps = spread * 1e-9 + 1e-14;
  return verts.filter((_, i) => projs[i] <= minProj + eps);
}

function buildDieConfig(sides: DieSides): DieConfig {
  const color = DIE_COLORS[sides];

  if (sides === 1) {
    // Sphere: always returns 1, no face detection needed (argmax over single direction always wins).
    const geo = new THREE.SphereGeometry(0.55, 16, 12);
    const faceDirections = [new THREE.Vector3(0, 1, 0)];
    const faceValues = [1];
    const pos = geo.getAttribute('position').array as Float32Array;
    return { geo, faceDirections, faceValues, materialFaceValues: [], hullPoints: pos, color };
  }

  if (sides === 2) {
    // Coin: cylinder with top=1, bottom=0. Rim gets -1 (plain color, no texture).
    // CylinderGeometry groups: 0=lateral surface, 1=top cap, 2=bottom cap.
    // Height 0.08 gives a realistic coin aspect ratio (h/d ≈ 0.07) that is
    // highly unstable on edge, so it almost always topples to a flat face.
    const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.08, 40);
    const faceDirections = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
    const faceValues = [1, 0];
    const pos = geo.getAttribute('position').array as Float32Array;
    return { geo, faceDirections, faceValues, materialFaceValues: [-1, 1, 0], hullPoints: pos, color };
  }

  if (sides === 3) {
    // D6 cube with opposite faces sharing the same value (1/1, 2/2, 3/3).
    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const faceDirections = [
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ];
    const faceValues = [1, 1, 2, 2, 3, 3];
    const pos = geo.getAttribute('position').array as Float32Array;
    // BoxGeometry groups are ordered: +X, -X, +Y, -Y, +Z, -Z
    const boxGroupDirs = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ];
    const materialFaceValues = boxGroupDirs.map((gd) => {
      const fi = faceDirections.findIndex((fd) => fd.dot(gd) > 0.99);
      return fi >= 0 ? faceValues[fi] : 0;
    });
    return { geo, faceDirections, faceValues, materialFaceValues, hullPoints: pos, color };
  }

  if (sides === 100) {
    // Zocchihedron: sphere mesh + 100 Fibonacci-distributed face directions.
    // No per-face geometry groups — rendered as a plain colored sphere.
    const geo = new THREE.SphereGeometry(0.72, 16, 12);
    const faceDirections = fibonacciSphereDirections(100);
    faceDirections.sort((a, b) => {
      const dy = b.y - a.y;
      if (Math.abs(dy) > 0.01) return dy;
      return Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x);
    });
    const faceValues = faceDirections.map((_, i) => i + 1);
    const pos = geo.getAttribute('position').array as Float32Array;
    return { geo, faceDirections, faceValues, materialFaceValues: [], hullPoints: pos, color };
  }

  if (sides === 1000) {
    // Tens percentile die: D10 geometry with face values 0, 10, 20, …, 90.
    const geo = buildD10Geometry();
    const origPos = geo.getAttribute('position') as THREE.BufferAttribute;
    const faceDirections = uniqueFaceDirections(geo);
    faceDirections.sort((a, b) => {
      const dy = b.y - a.y;
      if (Math.abs(dy) > 0.01) return dy;
      return Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x);
    });
    const faceValues = faceDirections.map((_, i) => i * 10); // 0, 10, 20, …, 90
    const hullPoints = new Float32Array(origPos.array as Float32Array);
    applyFaceGroupsAndUVs(geo, faceDirections);
    return { geo, faceDirections, faceValues, materialFaceValues: [...faceValues], hullPoints, color };
  }

  if (sides === 1001) {
    // Units percentile die: D10 geometry with face values 1-10.
    const geo = buildD10Geometry();
    const origPos = geo.getAttribute('position') as THREE.BufferAttribute;
    const faceDirections = uniqueFaceDirections(geo);
    faceDirections.sort((a, b) => {
      const dy = b.y - a.y;
      if (Math.abs(dy) > 0.01) return dy;
      return Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x);
    });
    const faceValues = faceDirections.map((_, i) => i + 1); // 1-10
    const hullPoints = new Float32Array(origPos.array as Float32Array);
    applyFaceGroupsAndUVs(geo, faceDirections);
    return { geo, faceDirections, faceValues, materialFaceValues: [...faceValues], hullPoints, color };
  }

  if (sides === 6) {
    // Cube: hardcode canonical face directions so values match real die layout.
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
    // BoxGeometry groups are in order: +X, -X, +Y, -Y, +Z, -Z
    const boxGroupDirs = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ];
    const materialFaceValues = boxGroupDirs.map((gd) => {
      const fi = faceDirections.findIndex((fd) => fd.dot(gd) > 0.99);
      return fi >= 0 ? faceValues[fi] : 0;
    });
    return { geo, faceDirections, faceValues, materialFaceValues, hullPoints: pos, color };
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

  const origPos = geo.getAttribute('position') as THREE.BufferAttribute;
  const allVerts = uniqueVertices(geo);
  const faceDirections = uniqueFaceDirections(geo);

  // Sort directions by descending Y then azimuth for a deterministic value order
  faceDirections.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 0.01) return dy;
    return Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x);
  });

  const faceValues = faceDirections.map((_, i) => i + 1);

  // Classify the die's top-feature type by checking one face.
  // For regular polyhedra every face yields the same count, so one sample suffices.
  // topFeatureVerts returns the vertices at the minimum projection onto faceDir —
  // no threshold, purely exact arithmetic on a finite set (see topFeatureVerts).
  //   1 vertex  → vertex-top (e.g. D4 tetrahedron)
  //   2 vertices → edge-top  (uncommon)
  //   3+ vertices → face-top (D8, D10, D12, D20, …)
  const topCount = topFeatureVerts(faceDirections[0], allVerts).length;
  const isVertexTop = topCount === 1;

  // Save hull points before applyFaceGroupsAndUVs replaces the position attribute
  const hullPoints = new Float32Array(origPos.array as Float32Array);

  // ── Vertex-top path ────────────────────────────────────────────────────────
  // WHY BOTTOM FACE, NOT TOP:
  //   For face-top dice one face points cleanly upward after settling, so
  //   argmax is unambiguous.  For vertex-top dice NO face points upward — the
  //   side faces all lean at the same dihedral angle (e.g. ~70.5° for D4), so
  //   argmax picks whichever side happens to face the camera.  argmin is the
  //   reliable choice: exactly one face is flat on the table (normal pointing
  //   straight down), and its faceValue is pre-assigned to match the top vertex.
  //
  //   faceCornerData being non-null is the runtime sentinel that tells readFaceUp
  //   and the renderer to use vertex-top logic.  Adding any vertex-top shape to
  //   the switch above is therefore sufficient — no other code needs touching.
  let faceCornerData: FaceCornerData[] | undefined;

  if (isVertexTop) {
    // Map each top vertex to the value of the face it sits opposite to.
    const vertexValues = new Map<THREE.Vector3, number>();
    for (let fi = 0; fi < faceDirections.length; fi++) {
      const top = topFeatureVerts(faceDirections[fi], allVerts);
      if (top.length === 1) vertexValues.set(top[0], faceValues[fi]);
    }

    // For each face: find its first triangle, look up corner vertex values,
    // and compute UV positions mirroring applyFaceGroupsAndUVs exactly.
    // (Assumes vertex-top faces are triangles, which holds for all standard dice.)
    faceCornerData = faceDirections.map((fd) => {
      let triStart = -1;
      for (let i = 0; i < origPos.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(origPos, i);
        const b = new THREE.Vector3().fromBufferAttribute(origPos, i + 1);
        const c = new THREE.Vector3().fromBufferAttribute(origPos, i + 2);
        const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        if (n.dot(a.clone().add(b).add(c)) < 0) n.negate();
        // Both normals are unit vectors derived from the same geometry, so
        // floating-point distance is well below 1e-6 for a true match.
        if (n.distanceTo(fd) < 1e-6) { triStart = i; break; }
      }

      const corners = [0, 1, 2].map((vi) =>
        new THREE.Vector3().fromBufferAttribute(origPos, triStart + vi)
      );
      const cornerValues = corners.map((c) => {
        const match = allVerts.find((u) => u.distanceTo(c) < 1e-10 * (c.length() + 1));
        return match ? (vertexValues.get(match) ?? 0) : 0;
      }) as [number, number, number];

      const t = corners[1].clone().sub(corners[0]).normalize();
      const bt = new THREE.Vector3().crossVectors(fd, t).normalize();
      const us = corners.map((v) => v.dot(t));
      const vs = corners.map((v) => v.dot(bt));
      const centU = (us[0] + us[1] + us[2]) / 3;
      const centV = (vs[0] + vs[1] + vs[2]) / 3;
      const circumR = Math.max(...corners.map((_, k) => Math.hypot(us[k] - centU, vs[k] - centV)));
      const scale = (0.5 - 0.1) / circumR;
      const uvs = [0, 1, 2].map((k) => [
        0.5 + (us[k] - centU) * scale,
        0.5 + (vs[k] - centV) * scale,
      ]) as [[number, number], [number, number], [number, number]];

      return { values: cornerValues, uvs };
    });
  }

  applyFaceGroupsAndUVs(geo, faceDirections);

  return { geo, faceDirections, faceValues, materialFaceValues: [...faceValues], hullPoints, color, faceCornerData };
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
  // For dice whose physics cannot be made provably fair (currently d2/coin),
  // the uniformly-sampled faceIdx result is stored here and returned directly
  // from readFaceUp(), bypassing the physics orientation readout.  The visual
  // animation still runs; only the announced result is RNG-determined.
  fixedResult?: number;
}


const GRAVITY = -25;
const FIXED_STEP = 1 / 60;
const SETTLE_DELAY = 0.5;   // seconds after roll before we check settle
const MAX_ROLL_TIME = 9;    // hard timeout: force-stop after this many sim-seconds
const PLAY_HALF = 4.5;      // half-size of playable area (dice spawn within ±PLAY_HALF)
const DEATH_Y = -5;         // y below which a die is considered escaped
const DEATH_XZ = 15;        // |x| or |z| beyond which a die is considered escaped

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
      // 1000/1001 = percentile dice (D10 geometry) — treat like a regular D10, not high-order
      const highOrder = s > 20 && s !== 1000 && s !== 1001;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(0, 5, 0)
          .setLinearDamping(0.2)
          .setAngularDamping(highOrder ? 1.2 : 0.4)
      );

      let collider: RAPIER.ColliderDesc;
      if (s === 1) {
        collider = RAPIER.ColliderDesc.ball(0.55);
      } else if (s === 2) {
        collider = RAPIER.ColliderDesc.cylinder(0.04, 0.55);
      } else if (s === 3 || s === 6) {
        collider = RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4);
      } else if (s === 100) {
        collider = RAPIER.ColliderDesc.ball(0.72);
      } else {
        collider = RAPIER.ColliderDesc.convexHull(config.hullPoints) ?? RAPIER.ColliderDesc.ball(0.5);
      }
      collider.setRestitution(highOrder ? 0.15 : 0.4).setFriction(highOrder ? 0.95 : 0.6);
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

    const worldUp = new THREE.Vector3(0, 1, 0);

    for (const die of this.dice) {
      const x = (rng() - 0.5) * spread * 2;
      const z = (rng() - 0.5) * spread * 2;
      // Keep spawn height low: max y-velocity + gravity means max apex ~3.5 m,
      // well below the wall top at y=8
      die.body.setTranslation({ x, y: 1.5 + rng() * 0.5, z }, true);

      // Starting orientation — three layers, all driven by the shared seed so
      // every client running the same seed sees identical physics:
      //
      // 1. FACE INDEX  (1 rng draw)
      //    Sample which face starts pointing "up" (face-top) or "down" (vertex-top
      //    D4) uniformly in [0, N).  Guarantees P(face i starts up) = 1/N exactly,
      //    correcting the systematic bias a uniform SO(3) quaternion leaves behind
      //    once the always-upward throw impulse is applied.
      //
      // 2. YAW  (1 rng draw)
      //    Full 360° rotation around the world-up axis.  The chosen face stays up
      //    but the die's horizontal orientation is randomised, averaging out any
      //    directional bias introduced by the fixed-upward impulse direction.
      //
      // 3. TILT  (3 rng draws)
      //    Small random tilt (≤ ~20°) around a random horizontal axis.  Breaks
      //    the exactly-face-flat start so the throw sees a variety of initial
      //    conditions each roll, reducing systematic landing bias further.
      const numFaces = die.config.faceDirections.length;
      const faceIdx = Math.floor(rng() * numFaces) % numFaces;
      const faceDir = die.config.faceDirections[faceIdx];

      // d2 (coin): flat-disk physics cannot be made provably fair — a thin coin
      // spinning around its symmetry axis has no face-changing effect, so the yaw
      // layer does nothing for it, and the residual physics bias is persistent.
      // Lock the result to the uniformly-sampled face index; animation still plays.
      die.fixedResult = die.sides === 2 ? die.config.faceValues[faceIdx] : undefined;

      const alignDir = die.config.faceCornerData
        ? new THREE.Vector3(-faceDir.x, -faceDir.y, -faceDir.z)
        : faceDir.clone();
      const faceQ = new THREE.Quaternion().setFromUnitVectors(alignDir.normalize(), worldUp);

      const yawQ = new THREE.Quaternion().setFromAxisAngle(worldUp, rng() * Math.PI * 2);

      const tiltAngle = rng() * 0.35; // up to ~20°
      const tx = rng() - 0.5;
      const tz = rng() - 0.5;
      const tLen = Math.hypot(tx, tz);
      const tiltQ = tLen > 1e-6
        ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(tx / tLen, 0, tz / tLen), tiltAngle)
        : new THREE.Quaternion();

      // Apply right-to-left: face alignment first, then yaw around world-up,
      // then tilt — all in world space so the face-up guarantee is preserved.
      const finalQ = tiltQ.multiply(yawQ).multiply(faceQ);
      die.body.setRotation({ x: finalQ.x, y: finalQ.y, z: finalQ.z, w: finalQ.w }, true);

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
      this.recoverEscapedDice();
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

  // ─── Death plane ────────────────────────────────────────────────────────────

  private recoverEscapedDice() {
    const n = this.dice.length;
    for (let i = 0; i < n; i++) {
      const d = this.dice[i];
      const pos = d.body.translation();
      if (pos.y > DEATH_Y && Math.abs(pos.x) <= DEATH_XZ && Math.abs(pos.z) <= DEATH_XZ) continue;

      // Spread recovered dice symmetrically along X so they don't stack
      const rx = (i - (n - 1) / 2) * 0.9;
      d.body.setTranslation({ x: rx, y: 3, z: 0 }, true);
      d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      d.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      d.body.wakeUp();
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

  /**
   * Advance the simulation by exactly n fixed steps without rendering or
   * the accumulator.  Intended for headless statistical testing only — call
   * in tight async loops and yield to the event loop periodically so the UI
   * stays responsive.
   */
  stepMany(n: number) {
    for (let i = 0; i < n; i++) {
      this.world.step();
      this.simTime += FIXED_STEP;
      this.recoverEscapedDice();
    }
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

  /** Kill switch: stop any ongoing roll and clear dice immediately. */
  forceReset() {
    for (const d of this.dice) this.world.removeRigidBody(d.body);
    this.dice = [];
    this.rollTime = -1;
    this.forceSettled = false;
  }

  private readFaceUp(d: SimDie): number {
    if (d.fixedResult !== undefined) return d.fixedResult;

    const r = d.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const up = new THREE.Vector3(0, 1, 0);

    if (d.config.faceCornerData) {
      // Vertex-top die (D4): use argmin — find the face whose outward normal points
      // most downward, i.e. the face resting on the table.
      //
      // WHY NOT argmax: a settled D4 has no face pointing upward.  The three visible
      // side faces all lean outward at the same ~70.5° dihedral angle, so their
      // normals have comparable upward Y components.  argmax picks whichever happens
      // to face the camera — it varies with roll orientation and does not identify the
      // result vertex.  The bottom face IS uniquely defined: exactly one face is flat
      // on the table, giving it the most downward-pointing normal.
      //
      // faceValues[bottom] was set during buildD4Config to equal the value of the
      // vertex opposite that face (= the top vertex), so no further lookup is needed.
      let worst = Infinity;
      let worstIdx = 0;
      for (let i = 0; i < d.config.faceDirections.length; i++) {
        const dot = d.config.faceDirections[i].clone().applyQuaternion(q).dot(up);
        if (dot < worst) { worst = dot; worstIdx = i; }
      }
      return d.config.faceValues[worstIdx];
    }

    // Face-top dice (D6, D8, D12, D20): result is the face whose outward normal
    // points most upward — that face is visible from above and carries the number.
    let best = -Infinity;
    let bestIdx = 0;
    for (let i = 0; i < d.config.faceDirections.length; i++) {
      const dot = d.config.faceDirections[i].clone().applyQuaternion(q).dot(up);
      if (dot > best) { best = dot; bestIdx = i; }
    }
    return d.config.faceValues[bestIdx];
  }

  dispose() {
    this.world.free();
  }
}

export { getDieConfig };
