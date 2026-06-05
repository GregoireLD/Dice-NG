import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DieTransform, getDieConfig, FaceCornerData } from '../physics/DiceSimulation';
import { DieSides } from '../dice/types';

/** Scale down font for face shapes that are smaller than their UV bounding box. */
function faceFontScale(sides: DieSides): number {
  if (sides === 4 || sides === 8 || sides === 20) return 0.55; // equilateral triangle
  if (sides === 10) return 0.60; // kite
  return 1.0; // square (D6) or pentagon (D12)
}

/**
 * Renders a triangular face texture for vertex-top dice (e.g. D4).
 *
 * WHY THREE NUMBERS PER FACE:
 *   D4 rests on a face; the result is the vertex at the top.  That vertex has no
 *   surface of its own to carry a number, so the value is printed on each of the
 *   three surrounding faces, near the shared corner.  The reader looks at any
 *   visible face and reads the number at the topmost corner.
 *
 * UV → CANVAS COORDINATE MAPPING (easy mistake):
 *   Three.js CanvasTexture uses flipY = true by default, so the canvas Y axis is
 *   inverted relative to UV V:
 *     canvas x = u * S
 *     canvas y = (1 − v) * S
 *   The UV coordinates here come directly from applyFaceGroupsAndUVs, which
 *   centers each face at UV (0.5, 0.5) and fits it in [0.1, 0.9].
 *   Numbers are pulled 30% toward center (factor 0.7) so they stay inside the
 *   triangular ink area rather than bleeding into the black margin.
 */
function createVertexTopFaceTexture(cornerData: FaceCornerData, dieColor: number): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  const r = (dieColor >> 16) & 0xff;
  const g = (dieColor >> 8) & 0xff;
  const b = dieColor & 0xff;
  ctx.fillStyle = `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)})`;
  ctx.fillRect(0, 0, S, S);

  const fontSize = Math.round(S * 0.19);
  ctx.font = `900 ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = S * 0.04;
  ctx.shadowOffsetX = S * 0.015;
  ctx.shadowOffsetY = S * 0.015;

  for (let k = 0; k < 3; k++) {
    const [u, v] = cornerData.uvs[k];
    // Convert UV to canvas coords then pull 30% toward center
    const cx = u * S;
    const cy = (1 - v) * S;
    const px = S / 2 + (cx - S / 2) * 0.7;
    const py = S / 2 + (cy - S / 2) * 0.7;
    ctx.fillText(String(cornerData.values[k]), px, py);
  }

  const tex = new THREE.CanvasTexture(canvas);
  if ('SRGBColorSpace' in THREE) {
    (tex as { colorSpace: string }).colorSpace = (THREE as { SRGBColorSpace: string }).SRGBColorSpace;
  }
  return tex;
}

function createFaceTexture(value: number, dieColor: number, fontScale = 1.0): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // Face background: die color darkened for contrast
  const r = (dieColor >> 16) & 0xff;
  const g = (dieColor >> 8) & 0xff;
  const b = dieColor & 0xff;
  ctx.fillStyle = `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)})`;
  ctx.fillRect(0, 0, S, S);

  const text = String(value);
  const fontSize = Math.round((text.length === 1 ? S * 0.65 : S * 0.48) * fontScale);
  ctx.font = `900 ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = S * 0.06;
  ctx.shadowOffsetX = S * 0.025;
  ctx.shadowOffsetY = S * 0.025;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, S / 2, S / 2);

  // Underline 6 and 9 to disambiguate them
  if (value === 6 || value === 9) {
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.round(S * 0.04);
    ctx.lineCap = 'round';
    const lw = fontSize * 0.45;
    const ly = S / 2 + fontSize * 0.38;
    ctx.beginPath();
    ctx.moveTo(S / 2 - lw / 2, ly);
    ctx.lineTo(S / 2 + lw / 2, ly);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  // Ensure correct color rendering with tone-mapping pipeline
  if ('SRGBColorSpace' in THREE) {
    (tex as { colorSpace: string }).colorSpace = (THREE as { SRGBColorSpace: string }).SRGBColorSpace;
  }
  return tex;
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private dieMeshes: THREE.Mesh[] = [];

  constructor(canvas: HTMLCanvasElement) {
    // ─── Renderer ────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // ─── Scene ───────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 20, 40);

    // ─── Camera ──────────────────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 12, 14);
    this.camera.lookAt(0, 0, 0);

    // ─── Controls ────────────────────────────────────────────────────────────
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 5;
    this.controls.maxDistance = 30;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.buildScene();
  }

  // ─── Scene construction ───────────────────────────────────────────────────

  private buildScene() {
    // Ambient
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Key light
    const key = new THREE.DirectionalLight(0xfff5e0, 1.4);
    key.position.set(6, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.bias = -0.001;
    this.scene.add(key);

    // Rim light
    const rim = new THREE.DirectionalLight(0x8080ff, 0.4);
    rim.position.set(-6, 4, -8);
    this.scene.add(rim);

    // Table surface
    const tableGeo = new THREE.CylinderGeometry(7.5, 7.5, 0.2, 64);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x1a4731,
      roughness: 0.9,
      metalness: 0.0,
    });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.y = -0.1;
    table.receiveShadow = true;
    this.scene.add(table);

    // Table rim
    const rimGeo = new THREE.TorusGeometry(7.5, 0.25, 8, 64);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x4a2810, roughness: 0.6, metalness: 0.2 });
    const tableRim = new THREE.Mesh(rimGeo, rimMat);
    tableRim.rotation.x = Math.PI / 2;
    tableRim.position.y = -0.05;
    this.scene.add(tableRim);
  }

  // ─── Die mesh management ─────────────────────────────────────────────────

  setDice(sides: DieSides[]) {
    for (const m of this.dieMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    }
    this.dieMeshes = [];

    for (const s of sides) {
      const cfg = getDieConfig(s);

      const fontScale = faceFontScale(s);
      const mat: THREE.Material | THREE.Material[] =
        cfg.materialFaceValues.length > 0
          ? cfg.materialFaceValues.map((val, fi) => {
              const cornerData = cfg.faceCornerData?.[fi];
              return new THREE.MeshStandardMaterial({
                map: cornerData
                  ? createVertexTopFaceTexture(cornerData, cfg.color)
                  : createFaceTexture(val, cfg.color, fontScale),
                roughness: 0.4,
                metalness: 0.15,
                envMapIntensity: 0.8,
              });
            })
          : new THREE.MeshStandardMaterial({
              color: cfg.color,
              roughness: 0.35,
              metalness: 0.25,
              envMapIntensity: 0.8,
            });

      const mesh = new THREE.Mesh(cfg.geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
      this.dieMeshes.push(mesh);
    }
  }

  updateDice(transforms: DieTransform[]) {
    for (let i = 0; i < transforms.length && i < this.dieMeshes.length; i++) {
      const t = transforms[i];
      this.dieMeshes[i].position.copy(t.position);
      this.dieMeshes[i].quaternion.copy(t.quaternion);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose() {
    this.controls.dispose();
    this.renderer.dispose();
  }
}
