import * as THREE from "three";
import type { SceneJob, SceneModel, SceneStation } from "./scene-model.ts";

export type Flowline3DStats = {
  geometries: number;
  textures: number;
  calls: number;
  triangles: number;
  frames: number;
  frameSamples: number;
  medianFrameTime: number;
  p95FrameTime: number;
  medianFps: number;
};

export type Flowline3DController = {
  update: (model: SceneModel) => void;
  resize: () => void;
  setVisible: (visible: boolean) => void;
  getStats: () => Flowline3DStats;
  dispose: () => void;
};

export type Flowline3DOptions = {
  reducedMotion?: boolean;
  preserveDrawingBuffer?: boolean;
};

const COLORS = {
  background: 0x071428,
  floor: 0x0d2340,
  floorLine: 0x234b70,
  ink: 0xc6e8f4,
  muted: 0x5c829d,
  prep: 0xff6f91,
  dispatch: 0x49d9df,
  critical: 0xffc857,
  ghost: 0x9be9f1,
  disruption: 0xff5475,
  clear: 0x4ee1b4,
  watch: 0xffc857,
  missed: 0xff5475,
};

const MAX_JOBS = 4;
const STATION_X: Record<SceneStation["id"], number> = { prep: -3.2, dispatch: 3.2 };
const JOB_Z: number[] = [-1.05, -0.35, 0.35, 1.05];

type TrackedMaterial = THREE.Material & { color?: THREE.Color; opacity?: number; transparent?: boolean };

type JobVisual = {
  group: THREE.Group;
  token: THREE.Mesh;
  halo: THREE.Mesh;
  outline: THREE.Mesh;
  material: TrackedMaterial;
  outlineMaterial: TrackedMaterial;
  haloMaterial: TrackedMaterial;
};

type StationVisual = {
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMaterial: TrackedMaterial;
  capacityBars: THREE.Mesh[];
  capacityMaterials: TrackedMaterial[];
};

function addMaterial(material: TrackedMaterial, materials: Set<TrackedMaterial>): TrackedMaterial {
  materials.add(material);
  return material;
}

function addGeometry<T extends THREE.BufferGeometry>(geometry: T, geometries: Set<THREE.BufferGeometry>): T {
  geometries.add(geometry);
  return geometry;
}

function statusColor(job: SceneJob): number {
  if (job.status === "missed") return COLORS.missed;
  if (job.status === "at-risk") return COLORS.watch;
  return job.priority === "critical" ? COLORS.critical : COLORS.clear;
}

function timeToX(time: number, horizon: number): number {
  return -4.8 + Math.min(1, Math.max(0, time / Math.max(1, horizon))) * 9.6;
}

function progressFor(job: SceneJob, horizon: number): number {
  const completion = Math.min(1, Math.max(0, job.dispatchEnd / Math.max(1, horizon)));
  const waitingWeight = Math.min(0.22, job.waiting * 0.04);
  return Math.min(1, Math.max(0, completion - waitingWeight));
}

function createStationVisual(
  station: SceneStation,
  scene: THREE.Scene,
  geometries: Set<THREE.BufferGeometry>,
  materials: Set<TrackedMaterial>,
): StationVisual {
  const group = new THREE.Group();
  group.name = `station-${station.id}`;
  group.position.set(STATION_X[station.id], 0.15, 0);

  const baseGeometry = addGeometry(new THREE.BoxGeometry(2.7, 0.28, 2.5), geometries);
  const baseMaterial = addMaterial(new THREE.MeshStandardMaterial({ color: station.id === "prep" ? 0x452841 : 0x123d56, roughness: 0.82, metalness: 0.05 }), materials);
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0;
  group.add(base);

  const upperGeometry = addGeometry(new THREE.BoxGeometry(2.15, 0.62, 1.82), geometries);
  const upperMaterial = addMaterial(new THREE.MeshStandardMaterial({ color: station.id === "prep" ? 0x7e3f62 : 0x1d6876, roughness: 0.58, metalness: 0.16 }), materials);
  const upper = new THREE.Mesh(upperGeometry, upperMaterial);
  upper.position.y = 0.42;
  group.add(upper);

  const ringGeometry = addGeometry(new THREE.TorusGeometry(1.22, 0.045, 6, 24), geometries);
  const ringMaterial = addMaterial(new THREE.MeshBasicMaterial({ color: COLORS.muted, transparent: true, opacity: 0.38 }), materials);
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.62;
  group.add(ring);

  const capacityBars: THREE.Mesh[] = [];
  const capacityMaterials: TrackedMaterial[] = [];
  const barGeometry = addGeometry(new THREE.BoxGeometry(0.12, 0.12, 0.72), geometries);
  for (let index = 0; index < 2; index += 1) {
    const barMaterial = addMaterial(new THREE.MeshBasicMaterial({ color: station.id === "prep" ? COLORS.prep : COLORS.dispatch, transparent: true, opacity: index < station.activeCapacity ? 0.92 : 0.18 }), materials);
    const bar = new THREE.Mesh(barGeometry, barMaterial);
    bar.position.set(-0.36 + index * 0.72, 0.86, 0.78);
    group.add(bar);
    capacityBars.push(bar);
    capacityMaterials.push(barMaterial);
  }

  scene.add(group);
  return { group, ring, ringMaterial, capacityBars, capacityMaterials };
}

function createJobVisual(
  index: number,
  ghost: boolean,
  scene: THREE.Scene,
  geometries: Set<THREE.BufferGeometry>,
  materials: Set<TrackedMaterial>,
): JobVisual {
  const group = new THREE.Group();
  group.name = `${ghost ? "ghost" : "job"}-${index}`;
  const tokenGeometry = addGeometry(new THREE.OctahedronGeometry(0.31, 0), geometries);
  const tokenMaterial = addMaterial(new THREE.MeshStandardMaterial({ color: COLORS.ink, roughness: 0.35, metalness: 0.34, transparent: ghost, opacity: ghost ? 0.35 : 1 }), materials);
  const token = new THREE.Mesh(tokenGeometry, tokenMaterial);
  token.position.y = ghost ? 0.72 : 0.78;
  group.add(token);

  const outlineGeometry = addGeometry(new THREE.OctahedronGeometry(0.42, 0), geometries);
  const outlineMaterial = addMaterial(new THREE.MeshBasicMaterial({ color: COLORS.ghost, wireframe: true, transparent: true, opacity: ghost ? 0.5 : 0 }), materials);
  const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
  outline.position.copy(token.position);
  group.add(outline);

  const haloGeometry = addGeometry(new THREE.RingGeometry(0.42, 0.47, 24), geometries);
  const haloMaterial = addMaterial(new THREE.MeshBasicMaterial({ color: COLORS.ghost, transparent: true, opacity: 0 }), materials);
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.48;
  group.add(halo);

  group.visible = false;
  scene.add(group);
  return { group, token, halo, outline, material: tokenMaterial, outlineMaterial, haloMaterial };
}

function updateJobVisual(visual: JobVisual, job: SceneJob, horizon: number, ghost: boolean): void {
  const progress = progressFor(job, horizon);
  const x = -3.2 + progress * 6.4;
  const z = JOB_Z[job.queuePosition] ?? JOB_Z[0];
  visual.group.visible = true;
  visual.group.position.set(x, 0, z);
  visual.token.position.y = ghost ? 0.7 : 0.78;
  visual.outline.position.y = visual.token.position.y;
  visual.material.color?.setHex(ghost ? COLORS.ghost : statusColor(job));
  visual.material.opacity = ghost ? 0.26 : 1;
  visual.material.transparent = ghost;
  visual.outlineMaterial.opacity = ghost || job.selected ? (ghost ? 0.62 : 0.9) : 0;
  visual.outlineMaterial.color?.setHex(job.selected ? COLORS.ink : COLORS.ghost);
  visual.haloMaterial.color?.setHex(job.selected ? COLORS.ink : statusColor(job));
  visual.haloMaterial.opacity = job.selected ? 0.82 : job.priority === "critical" && !ghost ? 0.34 : 0;
  visual.halo.scale.setScalar(job.selected ? 1.15 : 1);
}

function setStationState(visual: StationVisual, station: SceneStation, emphasized: boolean): void {
  visual.group.scale.set(emphasized ? 1.07 : 1, emphasized ? 1.07 : 1, emphasized ? 1.07 : 1);
  visual.ringMaterial.color?.setHex(station.disrupted ? COLORS.disruption : station.bottleneck ? COLORS.critical : COLORS.muted);
  visual.ringMaterial.opacity = station.disrupted ? 0.9 : station.bottleneck ? 0.78 : 0.34;
  for (let index = 0; index < visual.capacityBars.length; index += 1) {
    const active = index < station.activeCapacity;
    visual.capacityMaterials[index].opacity = active ? 0.92 : 0.15;
    visual.capacityMaterials[index].color?.setHex(station.disrupted && !active ? COLORS.disruption : station.id === "prep" ? COLORS.prep : COLORS.dispatch);
  }
}

function disposeObject(object: THREE.Object3D, geometries: Set<THREE.BufferGeometry>, materials: Set<TrackedMaterial>): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => materials.add(item as TrackedMaterial));
    else if (material) materials.add(material as TrackedMaterial);
  });
}

export function createFlowline3D(canvas: HTMLCanvasElement, initialModel: SceneModel, options: Flowline3DOptions = {}): Flowline3DController {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<TrackedMaterial>();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: options.preserveDrawingBuffer ?? false });
  } catch {
    throw new Error("WebGL is unavailable in this browser.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setClearColor(COLORS.background, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // The camera sits roughly 17 units from the floor.  Keeping the fog finish
  // beyond the scene preserves depth without washing the causal slice into the
  // background.
  scene.fog = new THREE.Fog(COLORS.background, 11, 34);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  camera.position.set(0, 8.6, 17.4);
  const cameraTarget = new THREE.Vector3(0, 0.55, 0);
  const cameraDesired = new THREE.Vector3(0, 6.2, 12.4);
  const cameraLookDesired = new THREE.Vector3(0, 0.55, 0);

  const ambient = new THREE.AmbientLight(0x9bd6e2, 1.4);
  const key = new THREE.DirectionalLight(0xd8faff, 2.4);
  key.position.set(-3, 7, 4);
  scene.add(ambient, key);

  const floorGeometry = addGeometry(new THREE.PlaneGeometry(13, 7), geometries);
  const floorMaterial = addMaterial(new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.92, metalness: 0.04 }), materials);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  scene.add(floor);

  const grid = new THREE.GridHelper(13, 26, COLORS.floorLine, 0x12304d);
  grid.position.y = -0.045;
  scene.add(grid);
  disposeObject(grid, geometries, materials);

  const transferGeometry = addGeometry(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.7, 0.12, 0),
    new THREE.Vector3(0, 0.42, 0),
    new THREE.Vector3(1.7, 0.12, 0),
  ]), geometries);
  const transferMaterial = addMaterial(new THREE.LineDashedMaterial({ color: COLORS.dispatch, dashSize: 0.24, gapSize: 0.16, transparent: true, opacity: 0.72 }), materials);
  const transfer = new THREE.Line(transferGeometry, transferMaterial);
  transfer.computeLineDistances();
  scene.add(transfer);

  const deadlineGeometry = addGeometry(new THREE.BoxGeometry(0.035, 0.035, 5.5), geometries);
  const deadlineMaterial = addMaterial(new THREE.MeshBasicMaterial({ color: COLORS.critical, transparent: true, opacity: 0.74 }), materials);
  const deadline = new THREE.Mesh(deadlineGeometry, deadlineMaterial);
  deadline.rotation.y = Math.PI / 2;
  deadline.position.y = 0.03;
  scene.add(deadline);

  const disruptionGeometry = addGeometry(new THREE.PlaneGeometry(1.3, 2.3), geometries);
  const disruptionMaterial = addMaterial(new THREE.MeshBasicMaterial({ color: COLORS.disruption, transparent: true, opacity: 0.22, side: THREE.DoubleSide }), materials);
  const disruption = new THREE.Mesh(disruptionGeometry, disruptionMaterial);
  disruption.rotation.x = -Math.PI / 2;
  disruption.position.set(STATION_X.dispatch + 0.63, 0.04, 0);
  scene.add(disruption);

  const stationVisuals = new Map<SceneStation["id"], StationVisual>();
  for (const station of initialModel.stations) {
    stationVisuals.set(station.id, createStationVisual(station, scene, geometries, materials));
  }
  const jobVisuals = Array.from({ length: MAX_JOBS }, (_, index) => createJobVisual(index, false, scene, geometries, materials));
  const ghostVisuals = Array.from({ length: MAX_JOBS }, (_, index) => createJobVisual(index, true, scene, geometries, materials));

  let visible = true;
  let dirty = true;
  let animationFrame = 0;
  let animationUntil = 0;
  let disposed = false;
  const reducedMotion = Boolean(options.reducedMotion);
  let frameCount = 0;
  const frameTimes = new Float32Array(720);
  let frameSampleCount = 0;
  let frameCursor = 0;
  let lastFrameTime = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  function updateCamera(focus: SceneModel): void {
    const focusX = STATION_X[focus.focusedStationId] + (focus.selectedJobId ? 0.35 : 0);
    cameraDesired.set(focusX * 0.2, 6.2, 12.4);
    cameraLookDesired.set(focusX * 0.14, 0.4, 0);
    animationUntil = reducedMotion ? 0 : performance.now() + 420;
  }

  function updateVisuals(nextModel: SceneModel): void {
    for (const station of nextModel.stations) {
      const visual = stationVisuals.get(station.id);
      if (visual) setStationState(visual, station, station.id === nextModel.focusedStationId);
    }
    nextModel.jobs.forEach((job, index) => updateJobVisual(jobVisuals[index], job, nextModel.horizon, false));
    for (let index = nextModel.jobs.length; index < jobVisuals.length; index += 1) jobVisuals[index].group.visible = false;
    nextModel.ghostJobs.forEach((job, index) => updateJobVisual(ghostVisuals[index], job, nextModel.horizon, true));
    for (let index = nextModel.ghostJobs.length; index < ghostVisuals.length; index += 1) ghostVisuals[index].group.visible = false;
    deadline.position.x = timeToX(getDeadline(nextModel), nextModel.horizon);
    disruption.visible = nextModel.shockApplied;
    disruptionMaterial.opacity = nextModel.shockApplied ? 0.3 : 0;
    updateCamera(nextModel);
    dirty = true;
  }

  function getDeadline(nextModel: SceneModel): number {
    const critical = nextModel.jobs.find((job) => job.priority === "critical");
    return critical?.deadline ?? nextModel.horizon;
  }

  function renderFrame(now: number): void {
    animationFrame = 0;
    if (disposed || !visible || document.hidden) return;
    if (lastFrameTime > 0) {
      const delta = now - lastFrameTime;
      // Do not let a hidden-tab or offscreen pause pollute the active-frame
      // sample.  100 ms is well above a normal frame and below a pause gap.
      if (delta > 0 && delta <= 100) {
        frameTimes[frameCursor] = delta;
        frameCursor = (frameCursor + 1) % frameTimes.length;
        frameSampleCount = Math.min(frameSampleCount + 1, frameTimes.length);
      }
    }
    lastFrameTime = now;
    const animating = animationUntil > now;
    if (animating) {
      const remaining = Math.max(0, animationUntil - now);
      const progress = Math.min(1, 1 - remaining / 420);
      const eased = progress * (2 - progress);
      camera.position.x += (cameraDesired.x - camera.position.x) * Math.min(0.24, eased * 0.14 + 0.06);
      camera.position.y += (cameraDesired.y - camera.position.y) * 0.08;
      camera.position.z += (cameraDesired.z - camera.position.z) * 0.08;
      cameraTarget.x += (cameraLookDesired.x - cameraTarget.x) * 0.1;
      cameraTarget.y += (cameraLookDesired.y - cameraTarget.y) * 0.1;
      cameraTarget.z += (cameraLookDesired.z - cameraTarget.z) * 0.1;
      camera.lookAt(cameraTarget);
      for (const job of jobVisuals) {
        if (job.group.visible && job.haloMaterial.opacity > 0) job.halo.rotation.z += 0.03;
      }
    } else if (dirty) {
      camera.position.copy(cameraDesired);
      cameraTarget.copy(cameraLookDesired);
      camera.lookAt(cameraTarget);
      dirty = false;
    }
    renderer.render(scene, camera);
    frameCount += 1;
    if (animating) animationFrame = window.requestAnimationFrame(renderFrame);
  }

  function requestRender(): void {
    if (disposed || !visible || document.hidden || animationFrame) return;
    animationFrame = window.requestAnimationFrame(renderFrame);
  }

  function resize(): void {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 640);
    const height = Math.max(1, canvas.clientHeight || canvas.parentElement?.clientHeight || 420);
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    dirty = true;
    requestRender();
  }

  function getFrameStats(): Pick<Flowline3DStats, "frames" | "frameSamples" | "medianFrameTime" | "p95FrameTime" | "medianFps"> {
    if (!frameSampleCount) return { frames: frameCount, frameSamples: 0, medianFrameTime: 0, p95FrameTime: 0, medianFps: 0 };
    const samples = new Array<number>(frameSampleCount);
    const first = frameSampleCount === frameTimes.length ? frameCursor : 0;
    for (let index = 0; index < frameSampleCount; index += 1) {
      samples[index] = frameTimes[(first + index) % frameTimes.length];
    }
    samples.sort((left, right) => left - right);
    const percentile = (rank: number) => samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * rank))];
    const medianFrameTime = percentile(0.5);
    return {
      frames: frameCount,
      frameSamples: frameSampleCount,
      medianFrameTime,
      p95FrameTime: percentile(0.95),
      medianFps: medianFrameTime > 0 ? 1000 / medianFrameTime : 0,
    };
  }

  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
  resizeObserver?.observe(canvas);
  const intersectionObserver = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; if (visible) requestRender(); }, { threshold: 0.05 })
    : undefined;
  intersectionObserver?.observe(canvas);
  const onVisibilityChange = () => { if (!document.hidden) requestRender(); };
  document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });

  updateVisuals(initialModel);
  resize();
  requestRender();

  return {
    update(nextModel) {
      if (disposed) return;
      updateVisuals(nextModel);
      requestRender();
    },
    resize,
    setVisible(nextVisible) {
      visible = nextVisible;
      if (!visible && animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      if (visible) requestRender();
    },
    getStats() {
      return {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        ...getFrameStats(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      disposeObject(scene, geometries, materials);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
