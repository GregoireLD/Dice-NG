import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DieTransform, getDieConfig } from '../physics/DiceSimulation';
import { DieSides } from '../dice/types';

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
      (m.material as THREE.Material).dispose();
    }
    this.dieMeshes = [];

    for (const s of sides) {
      const cfg = getDieConfig(s);
      const mat = new THREE.MeshStandardMaterial({
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
