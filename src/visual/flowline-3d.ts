import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  InstancedMesh,
  LinearSRGBColorSpace,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
  type Blending,
  type Material,
  type Object3D,
} from "three";
import type { SceneBerth, SceneJob, SceneModel, SceneSite } from "./scene-model.ts";

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

/**
 * A label position, in percent of the canvas box. The scene projects its own
 * anchors so every word on the floor is DOM text sitting exactly over the
 * geometry it names — nothing is drawn into the canvas, and nothing is placed by
 * a hand-tuned percentage that a camera change could silently invalidate.
 */
export type SceneAnchor = { id: string; x: number; y: number };

export type Flowline3DController = {
  update: (model: SceneModel) => void;
  resize: () => void;
  /** Stand the camera at one of the four views, at a zoom the caller steps through. */
  setCamera: (view: FocusCameraView, zoom: number) => void;
  setVisible: (visible: boolean) => void;
  getStats: () => Flowline3DStats;
  getAnchors: () => SceneAnchor[];
  dispose: () => void;
};

export type Flowline3DOptions = {
  reducedMotion?: boolean;
  preserveDrawingBuffer?: boolean;
  onAnchors?: (anchors: SceneAnchor[]) => void;
};

const COLORS = {
  background: 0x031422,
  deck: 0x05131f,
  deckLine: 0x14344e,
  deckLineFaint: 0x0a2134,
  // The bays are bevelled charcoal steel rather than painted plate, so each one
  // needs four tones for the bevel to read: a dark outer wall, a lighter deck
  // inset from it, the kerb rail between them, and the lit cap along the lip.
  // Albedo runs brighter than the pixel it becomes, because the lit result is the
  // albedo dimmed by the key and ambient terms rather than the albedo itself.
  steel: 0x363b43,
  steelTop: 0x484f5a,
  steelRail: 0x3d434c,
  steelCap: 0x596069,
  lane: 0x21252b,
  // The slot ruler is colder and darker than the bays it stands in front of: it is
  // the deadline rail, not part of the plant.
  slot: 0x27313d,
  slotWall: 0x171f29,
  /** The machined pads let into the kerb tops, which is what breaks up a long rail. */
  pad: 0x8b949d,
  ink: 0xc6e8f4,
  gold: 0xffc857,
  teal: 0x4ee1b4,
  coral: 0xff5475,
  blue: 0x5aa9ff,
  live: 0x2fe08a,
  hazard: 0xd9a021,
  glow: 0x2f7fa8,
  /* The five job identities, given as the sRGB the chips and slabs are painted in on the
     board — not as material colours. A block's material is derived from these, because this
     floor is lit and the board is not: see TINT. */
  ice: 0xccd6ff,
  azure: 0x5cb8ee,
  violet: 0xb585f2,
  cobalt: 0x6f8bea,
  quartz: 0xe9a6dd,
};

/**
 * Which job a block is, on the floor as on the board: the same five sRGB values the queue
 * chips and the 2.5D slabs are painted in, so there is one palette rather than a DOM one
 * and a canvas one that drift apart.
 *
 * A material colour is not a painted pixel, though. This floor is lit and the board is not,
 * so handing these straight to a lit material is what made the floor unreadable: measured off
 * a 1440x900 screenshot of the four-job palette, those caps came out 5.2 to 11.7 ΔE apart —
 * one blue-grey, four times — while the chips they name are 23.7 apart. The cap therefore
 * takes the value here unlit and the body takes it through FACE_GAIN, which is the light
 * measured rather than guessed at.
 */
const TINT: Record<SceneJob["tint"], number> = {
  ice: COLORS.ice,
  azure: COLORS.azure,
  violet: COLORS.violet,
  cobalt: COLORS.cobalt,
  quartz: COLORS.quartz,
};

/**
 * What this rig does to a lit face, per channel, in the linear space three.js works in.
 * Measured rather than derived: two probe renders at 0x808080 and 0x303030 across every
 * block, sampled off the canvas, fitted as painted = GAIN x albedo. All four blocks painted
 * the same pixel from the same albedo, so one vector covers the floor, and the fit came back
 * with an offset under 0.012 — near enough to zero that fog and rim are ignored.
 *
 * The red channel is the whole story: a lit face returns 0.33 of the red it is given and
 * 0.57 of the blue, because the rig is blue — ambient 0x8fc7de, a 0xdff6ff key, a 0x3fb6c8
 * rim, and no tone mapping. Dividing the target by that is what puts violet back to violet.
 */
const FACE_GAIN = [0.334, 0.496, 0.566] as const;

/**
 * How much of the chip's own brightness the block's front face is asked for. The cap above
 * it carries the full value, so this is the shading step between the two, and the number
 * comes off the reference frames rather than out of the air: the fronts drawn there sit
 * between 0.10 and 0.22 of their own caps. Taking the top of that range keeps the meter and
 * the job's colour readable on the face while the cap stays clearly the lit one.
 */
const FACE_LEVEL = 0.22;

const ALBEDO = new Color();

/**
 * The albedo that paints `level` of `tint` on a lit face. Clamped at 1: a target the rig
 * cannot reach comes out as bright as it can rather than wrapping.
 */
function albedoFor(tint: number, level: number): Color {
  ALBEDO.setHex(tint);
  ALBEDO.setRGB(
    Math.min(1, (ALBEDO.r * level) / FACE_GAIN[0]),
    Math.min(1, (ALBEDO.g * level) / FACE_GAIN[1]),
    Math.min(1, (ALBEDO.b * level) / FACE_GAIN[2]),
    LinearSRGBColorSpace,
  );
  return ALBEDO;
}

type SlabSite = Exclude<SceneSite, "queue">;

/**
 * The floor, in world units. One table for the whole view: the geometry is built
 * from it and the label anchors are projected from it, so a site can never be
 * drawn in one place and named in another.
 */
const SITE: Record<SlabSite, [number, number, number]> = {
  "prep-a": [-8.0, 0.85, -2.3],
  "prep-b": [-5.3, 0.85, 1.1],
  gate: [0, 0.95, 0.2],
  "berth-1": [5.5, 0.85, 0.4],
  "berth-2": [8.5, 0.85, 0.4],
};

const SLAB_SITES: SlabSite[] = ["prep-a", "prep-b", "gate", "berth-1", "berth-2"];
const BERTH_X = [5.5, 8.5];

/** How far a block rises when it is the selected one. */
const LIFT = 0.22;
/** How high a block hops over the deck while it travels between two stands. */
const TRAVEL_ARC = 0.45;
/** How long the lift takes, and how long a travel takes, in milliseconds. */
const LIFT_MS = 320;
const TRAVEL_MS = 460;

/**
 * The four vantage points, given as an angle and a distance around the point each one
 * looks at rather than as a hand-placed position. Yaw is zero in all four, which is what
 * keeps the camera on the line it looks along, and so keeps a run of slot cells
 * projecting to a level row rather than a slope.
 *
 * `iso` is not a new framing: at pitch 30.16° and distance 20.70 the camera lands on
 * (0.4, 11.6, 18.6) looking at (0.4, 1.2, 0.7), which is where this floor has always
 * been seen from.
 */
export type FocusCameraView = "iso" | "top" | "prep" | "dispatch";

type CameraSpec = { target: [number, number, number]; pitch: number; distance: number };

const CAMERA_VIEWS: Record<FocusCameraView, CameraSpec> = {
  iso: { target: [0.4, 1.2, 0.7], pitch: 30.16, distance: 20.7 },
  top: { target: [0.4, 0.6, 0.2], pitch: 56, distance: 20.2 },
  prep: { target: [-6.6, 1.1, -0.4], pitch: 26, distance: 12.8 },
  dispatch: { target: [7, 1.1, -0.2], pitch: 26, distance: 13.6 },
};

/**
 * How far the caller may pull or push a view, as a multiplier on that view's own
 * distance. The steps themselves belong to the page, not here: this module is loaded
 * lazily, so a page that imported a constant out of it would pull three.js into the
 * first chunk to read five numbers. `setCamera` clamps to this range instead.
 */
const ZOOM_MIN = 0.85;
const ZOOM_MAX = 1.9;
const SLOT_Z = 5.6;
/**
 * The deadline rail runs wider than the frame on purpose: it is a rail the floor
 * stands in front of, not a bar floating over it, so it has to leave the frame at
 * both ends rather than stop short of them. Its cells are narrower than the bar and
 * centred in it, because a cell that falls off the edge of the canvas takes its own
 * slot number with it — the bar is scenery, the cells are the horizon the plan is
 * judged over.
 */
const SLOT_BAR = 19.4;
const SLOT_SPAN = 15;
const SLOT_H = 0.34;
const SLOT_D = 1.5;
const MAX_SLOTS = 12;
/** tan of half the horizontal field. The vertical field is derived from it. */
const H_HALF_TAN = 0.474;

/**
 * The bevel of every bay, in world units: the width of the kerb that runs around
 * the outer lip, how far the kerb rail stands above the deck, the thickness of the
 * deck plate inset behind it, and how much of each corner is cut away. One set of
 * numbers so the three bays read as cut from the same steel.
 */
const RIM = 0.42;
const RAIL_H = 0.28;
const PLATE = 0.06;
const CHAMFER = 0.52;

/**
 * The furniture a closed berth wears, in world units: how far up its own lane the
 * barred barrier stands, how high above the bay deck the padlock rides on that
 * barrier, and where the warning beacon's post stands. The barrier is up-lane rather
 * than across its mouth so the crossed-out pad in front of it stays readable, and the
 * padlock anchor is measured off the same numbers the barrier is built from, so the
 * mark cannot drift off the thing it locks.
 */
const BARRIER_Z = -1.15;
const LOCK_Y = 0.44;
const BEACON_DX = 0.52;
const BEACON_Z = 1.6;

/**
 * The routes run on the floor in front of the bays, and each keeps a pool of dash boxes
 * big enough for the longest path a plan can ask for: out to the far berth and back to
 * the first cell of the rail, at the tighter of the two dash rhythms.
 */
const ROUTE_Y = 0.06;
const ROUTE_DASHES = 64;

/** The centre of one cell of the slot kerb that runs across the front of the floor. */
function slotX(slot: number, slots: number): number {
  const cell = SLOT_SPAN / Math.max(1, slots);
  return -SLOT_SPAN / 2 + (slot - 0.5) * cell;
}

type TrackedMaterial = Material & { color?: Color; opacity?: number; transparent?: boolean };

type Tracked = {
  geometries: Set<BufferGeometry>;
  materials: Set<TrackedMaterial>;
};

function keepGeometry<T extends BufferGeometry>(geometry: T, tracked: Tracked): T {
  tracked.geometries.add(geometry);
  return geometry;
}

function keepMaterial<T extends TrackedMaterial>(material: T, tracked: Tracked): T {
  tracked.materials.add(material);
  return material;
}

/** A point on a floor outline. Height is never part of an outline: it is the extrusion. */
type Pt = { x: number; z: number };

/**
 * A rectangle with its corners cut, on the floor plane. Every deck, kerb and cradle
 * in the mock is an octagon rather than a rectangle, and that cut corner is what
 * makes flat-lit charcoal read as machined steel instead of as a painted card.
 */
function octagon(width: number, depth: number, cut: number): Pt[] {
  const x = width / 2;
  const z = depth / 2;
  const c = Math.max(0.02, Math.min(cut, Math.min(x, z) * 0.7));
  return [
    { x: -x + c, z: -z },
    { x: x - c, z: -z },
    { x, z: -z + c },
    { x, z: z - c },
    { x: x - c, z },
    { x: -x + c, z },
    { x: -x, z: z - c },
    { x: -x, z: -z + c },
  ];
}

/** The same outline pulled in by an even margin, with all of its edges kept parallel. */
function shrink(width: number, depth: number, cut: number, margin: number): Pt[] {
  // A 45 degree corner moves along its own bisector, so the cut shortens by rather
  // less than the margin the straight edges move by.
  return octagon(width - margin * 2, depth - margin * 2, cut - margin * 0.42);
}

/**
 * One part of a deck — a slab, a kerb ring, a cradle collar, a lit cap — as its top
 * face plus the walls that carry it down to `base`. Passing an inner outline makes it
 * a ring and draws the wall of the recess it leaves; passing equal heights makes it a
 * flat cap face with no walls at all.
 *
 * The triangles are written out here rather than extruded from a Shape because
 * the shape extruder is a large slice of three.js to pull into the bundle for eight
 * corners, and because unshared corner vertices are what keep every face of this
 * diorama flat-shaded.
 */
function deckPart(outer: Pt[], inner: Pt[] | undefined, base: number, top: number, tracked: Tracked): BufferGeometry {
  const out: number[] = [];
  const tri = (a: Pt, ay: number, b: Pt, by: number, c: Pt, cy: number) => {
    out.push(a.x, ay, a.z, b.x, by, b.z, c.x, cy, c.z);
  };
  const count = outer.length;
  // Every top face is wound clockwise across the floor plane, which is what points
  // its normal at the key light instead of at the ground.
  if (inner) {
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      tri(inner[index], top, inner[next], top, outer[next], top);
      tri(inner[index], top, outer[next], top, outer[index], top);
    }
  } else {
    for (let index = 1; index + 1 < count; index += 1) {
      tri(outer[0], top, outer[index + 1], top, outer[index], top);
    }
  }
  if (top > base) {
    for (let index = 0; index < count; index += 1) {
      const a = outer[index];
      const b = outer[(index + 1) % count];
      tri(a, base, b, top, b, base);
      tri(a, base, a, top, b, top);
    }
    // The recess wall is the outer wall wound the other way, so what you see standing
    // over the bay is the inside of the kerb rather than the back of it.
    if (inner) {
      for (let index = 0; index < count; index += 1) {
        const a = inner[index];
        const b = inner[(index + 1) % count];
        tri(a, base, b, base, b, top);
        tri(a, base, b, top, a, top);
      }
    }
  }
  const geometry = keepGeometry(new BufferGeometry(), tracked);
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(out), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One flat bar painted on a deck. Every floor marking is the same primitive at a
 * different angle: a mint flow chevron is two bars meeting at a point, and a hazard
 * rung is one bar let into the top of a kerb.
 */
type Painted = { x: number; y: number; z: number; angle: number; length: number; width: number };

/**
 * The three sets of flat markings the floor is built with: mint flow marks, amber
 * hazard rungs on the outer kerbs, and the machined pads that break up the rest of
 * the rails. They are gathered while the bays are built and drawn at the end, one
 * instanced mesh each, because an instanced mesh has to know how many marks it holds.
 */
type Marks = { flow: Painted[]; hazard: Painted[]; pad: Painted[] };

/** How far each arm of a chevron leans off the direction the chevron points. */
const ARM_LEAN = 0.66;

/**
 * A chevron pointing along -Z when `spin` is zero, which is straight up the screen
 * under this camera. The arms are placed by turning their own offset with the mark,
 * so one call paints both the up-deck flow arrows and the sideways ones that state
 * the direction of the handoff belt.
 */
function paintChevron(marks: Painted[], x: number, y: number, z: number, spin: number, size: number): void {
  for (const side of [-1, 1]) {
    const offset = side * 0.4 * size;
    marks.push({
      x: x + offset * Math.cos(spin),
      y,
      z: z - offset * Math.sin(spin),
      angle: spin - side * ARM_LEAN,
      length: size,
      width: 0.26 * size,
    });
  }
}

/**
 * A chevron with a stem behind it, pointing up the screen. The mock marks the two
 * places a job leaves the prep apron this way rather than with a bare chevron: a
 * chevron states flow along a lane, and an arrow states a way out of one.
 */
function paintArrow(marks: Painted[], x: number, y: number, z: number, size: number): void {
  paintChevron(marks, x, y, z, 0, size);
  marks.push({ x, y, z: z + size * 0.42, angle: Math.PI / 2, length: size * 0.86, width: size * 0.3 });
}

/**
 * Every flat marking on the floor shares one thin box and one draw call. None of
 * them ever moves once the floor is built, so a single instanced mesh is both
 * cheaper than fifty meshes and harder to let drift out of step. The parent is
 * passed in because a set of marks that belongs to one berth's closed state has to
 * be shown and hidden with that berth rather than with the floor.
 */
function buildPainted(marks: Painted[], color: number, opacity: number, decal: BoxGeometry, parent: Object3D, tracked: Tracked): void {
  if (!marks.length) return;
  const material = keepMaterial(new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, fog: false }), tracked);
  const mesh = new InstancedMesh(decal, material, marks.length);
  const turn = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const place = new Vector3();
  const size = new Vector3();
  const matrix = new Matrix4();
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index];
    turn.setFromAxisAngle(axis, mark.angle);
    place.set(mark.x, mark.y, mark.z);
    size.set(mark.length, 1, mark.width);
    mesh.setMatrixAt(index, matrix.compose(place, turn, size));
  }
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
}

/**
 * A disc that fades from a bright hub to a transparent rim, through vertex alpha
 * rather than a gradient image: this renderer loads no textures, and the sky glow, the
 * contact shadow under a block and the halo around a lit lamp all need a soft edge to
 * read as light. One geometry per size, shared by every disc drawn at that size.
 */
function fadedDisc(radius: number, strength: number, tracked: Tracked): BufferGeometry {
  const geometry = keepGeometry(new CircleGeometry(radius, 32), tracked);
  const count = geometry.getAttribute("position").count;
  const shade = new Float32Array(count * 4).fill(1);
  // CircleGeometry emits the hub vertex first and the rim after it, so the falloff
  // is one carrying vertex followed by transparent ones.
  for (let index = 0; index < count; index += 1) shade[index * 4 + 3] = index === 0 ? strength : 0;
  geometry.setAttribute("color", new BufferAttribute(shade, 4));
  return geometry;
}

/** The colour and blend one faded disc is drawn in. The falloff lives in the geometry. */
function discTone(color: number, blending: Blending, tracked: Tracked): TrackedMaterial {
  return keepMaterial(
    new MeshBasicMaterial({ color, vertexColors: true, transparent: true, depthWrite: false, blending, fog: false }),
    tracked,
  );
}

/**
 * The ring of a selection frame, upright in the XY plane so it can be turned to face
 * the camera. It is the same cut-cornered outline the decks are built from, for the
 * same reason: at this size a cut corner reads as a radius, and the mock's frame is a
 * rounded rectangle rather than a box drawn in perspective.
 */
function selectionRing(width: number, height: number, thickness: number, tracked: Tracked): BufferGeometry {
  const cut = Math.min(0.56, height * 0.34);
  const ring = deckPart(octagon(width, height, cut), shrink(width, height, cut, thickness), 0, 0, tracked);
  ring.rotateX(Math.PI / 2);
  return ring;
}

type Shapes = {
  slab: BoxGeometry;
  cap: BoxGeometry;
  meter: BoxGeometry;
  /** The two rings of a selection frame: one crisp edge, one wider band behind it. */
  frame: BufferGeometry;
  frameGlow: BufferGeometry;
  /** A lamp lens, and the halo that is drawn over it to burn its middle out to white. */
  lamp: CircleGeometry;
  glow: BufferGeometry;
  /** The occlusion under a job block, at one size for all five stands. */
  shadow: BufferGeometry;
  /** The stalk of a warning beacon. */
  post: CylinderGeometry;
  slat: BoxGeometry;
  /** A unit box every lane, span, inlay and rail is scaled from, so they cost one geometry between them. */
  unit: BoxGeometry;
  /** The bar behind every painted floor marking, scaled per instance. */
  decal: BoxGeometry;
};

/**
 * The materials every job block shares, as against the three it tints for the job
 * standing on it: the dark recess its meter is let into, the two rings of its selection
 * frame, and the occlusion under it. None of them says anything about which job is
 * there, so all five stands are cut from one set.
 */
type SlabTones = {
  track: TrackedMaterial;
  frame: TrackedMaterial;
  frameGlow: TrackedMaterial;
  shadow: TrackedMaterial;
};

type SlabVisual = {
  group: Group;
  fill: Mesh;
  frame: Group;
  shadow: Mesh;
  body: TrackedMaterial;
  cap: TrackedMaterial;
  meter: TrackedMaterial;
  /**
   * The stand the block left, the stand it is going to, and where it actually is now.
   * A block belongs to a job rather than to a pad, so when the plan moves that job the
   * same block travels between two stands instead of one block vanishing and another
   * appearing. `at` is the un-lifted position, which is what the next move starts from.
   */
  from: Vector3;
  to: Vector3;
  at: Vector3;
  travel: boolean;
  lift: number;
  /** Whether the block was on the floor before this update, so an arrival does not fly in. */
  shown: boolean;
};

/**
 * Everything in the scene that is a flat card turned to face the camera: lamp lenses,
 * halos, the selection reticle, the sky glow, the radar sweeps. Aiming one is a single
 * `lookAt(eye)`, which only holds while the camera stands still — and the view presets
 * move it — so every card is collected here and re-aimed together.
 */
type Cards = { eye: Vector3; faces: Object3D[] };

function face(cards: Cards, object: Object3D): void {
  object.lookAt(cards.eye);
  cards.faces.push(object);
}

/** A job block: solid body, lit cap, and a meter on the face that reads to camera. */
function buildSlab(name: string, shapes: Shapes, tones: SlabTones, cards: Cards, scene: Scene, tracked: Tracked): SlabVisual {
  const group = new Group();
  group.name = `slab-${name}`;

  const body = keepMaterial(new MeshStandardMaterial({ color: COLORS.steelTop, roughness: 0.52, metalness: 0.12 }), tracked);
  group.add(new Mesh(shapes.slab, body));

  // The cap is unlit, like the kerb rail's own lit strip, so it paints the job's colour
  // exactly rather than that colour through the rig. It loses nothing by it: the probe
  // renders that fitted GAIN put an identical pixel on all four caps from all four stands,
  // so this face never had any shading to lose. What it gains is a block that is the same
  // colour as its chip, and dark label ink that clears 4.5:1 on every one of the four.
  const cap = keepMaterial(new MeshBasicMaterial({ color: COLORS.steelTop, fog: false }), tracked);
  const capMesh = new Mesh(shapes.cap, cap);
  capMesh.position.y = 0.38;
  group.add(capMesh);

  // High enough on the face to clear the collar the block stands in: the meter is
  // read from the same distance as the label above it, so it cannot sit in the socket.
  const trackMesh = new Mesh(shapes.meter, tones.track);
  trackMesh.position.set(0, -0.1, 0.76);
  group.add(trackMesh);

  const meter = keepMaterial(new MeshBasicMaterial({ color: COLORS.ink }), tracked);
  const fill = new Mesh(shapes.meter, meter);
  fill.position.set(0, -0.1, 0.78);
  group.add(fill);

  // The selection frame is a flat reticle turned to face the fixed camera, not a cage
  // built around the block. On screen the mock's frame passes below the block's own
  // base and behind its top, and in world terms both of those are inside the bay it
  // stands on, so the frame is drawn over the scene instead of in it: no depth test, in
  // the pass that runs after the floor. Its wider ring is additive, which is what makes
  // a two pixel line read as a lit one rather than as a drawn border.
  const frame = new Group();
  frame.position.set(0, 0.08, 0.1);
  frame.renderOrder = 3;
  frame.visible = false;
  frame.add(new Mesh(shapes.frameGlow, tones.frameGlow), new Mesh(shapes.frame, tones.frame));
  group.add(frame);
  face(cards, frame);

  // The contact shadow is not parented to the block, so the lift raises the block and
  // leaves its shadow on the deck, and a travelling block drags the shadow along the
  // floor rather than carrying it through the air. It is wider than the block it sits
  // under: the key light is high and soft, so what reads at this angle is the occlusion
  // around the block, not a cast profile.
  const shadow = new Mesh(shapes.shadow, tones.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 0.66, 1);
  shadow.visible = false;
  scene.add(shadow);

  group.visible = false;
  scene.add(group);
  return {
    group,
    fill,
    frame,
    shadow,
    body,
    cap,
    meter,
    from: new Vector3(),
    to: new Vector3(),
    at: new Vector3(),
    travel: false,
    lift: 0,
    shown: false,
  };
}

/**
 * Dress one block for the plan it is in and record the stand it is headed for. Where it
 * physically is between two stands is left to the frame loop, so a job the plan moves
 * slides across the deck instead of jumping between two frames. A job with no stand on
 * the floor — queued, or already cleared — has no block at all.
 */
function applySlab(visual: SlabVisual, job: SceneJob | undefined, settled: boolean): void {
  if (!job || job.site === "queue") {
    visual.group.visible = false;
    visual.shadow.visible = false;
    visual.shown = false;
    visual.travel = false;
    return;
  }
  visual.group.visible = true;
  visual.shadow.visible = true;
  const tint = TINT[job.tint];
  visual.body.color?.copy(albedoFor(tint, FACE_LEVEL));
  visual.cap.color?.setHex(tint);
  visual.meter.color?.setHex(job.status === "missed" ? COLORS.coral : job.status === "at-risk" ? COLORS.gold : COLORS.live);
  const width = Math.max(0.06, Math.min(1, job.meter));
  visual.fill.scale.x = width;
  visual.fill.position.x = -0.7 + 0.7 * width;
  visual.frame.visible = job.selected;
  visual.lift = job.selected ? LIFT : 0;

  const stand = SITE[job.site];
  // A block already on the floor sets out from wherever it currently is, so a move
  // interrupted by the next one carries on from the interruption rather than snapping
  // back to the stand it started from.
  if (visual.shown) visual.from.copy(visual.at);
  else visual.from.set(stand[0], stand[1], stand[2]);
  visual.to.set(stand[0], stand[1], stand[2]);
  visual.travel = visual.from.distanceToSquared(visual.to) > 1e-4;
  visual.shown = true;
  if (settled) visual.at.copy(visual.to);
}

type PlatformSpec = {
  center: [number, number, number];
  size: [number, number, number];
  /** Which of the two side kerbs wear hazard rungs. */
  hazard: Array<"left" | "right">;
};

/**
 * The one set of tones the whole floor is cut from: the dark outer wall of a bay, the
 * lighter deck plate inset behind its kerb, the kerb rail itself, the lit cap along
 * its lip, and the dark inlay of a lane. Sharing them keeps the bays, the spans, the
 * cradles and the berths from drifting into four different metals, and the scene pays
 * for five materials rather than five per structure.
 */
type Steel = {
  wall: TrackedMaterial;
  plate: TrackedMaterial;
  rail: TrackedMaterial;
  cap: TrackedMaterial;
  lane: TrackedMaterial;
};

function buildSteel(tracked: Tracked): Steel {
  return {
    wall: keepMaterial(new MeshStandardMaterial({ color: COLORS.steel, roughness: 0.82, metalness: 0.24 }), tracked),
    plate: keepMaterial(new MeshStandardMaterial({ color: COLORS.steelTop, roughness: 0.7, metalness: 0.18 }), tracked),
    rail: keepMaterial(new MeshStandardMaterial({ color: COLORS.steelRail, roughness: 0.62, metalness: 0.3 }), tracked),
    cap: keepMaterial(new MeshBasicMaterial({ color: COLORS.steelCap }), tracked),
    lane: keepMaterial(new MeshBasicMaterial({ color: COLORS.lane }), tracked),
  };
}

/**
 * A bay deck as bevelled steel: a dark outer wall with cut corners, a lighter deck
 * plate inset by the width of the kerb so the wall below stays visible as a chamfer,
 * and a kerb rail with a lit cap running the whole way around the lip. It returns the
 * deck surface it built, so whatever stands on this bay is placed from the geometry
 * instead of from a height copied by hand into another block.
 */
function buildPlatform(spec: PlatformSpec, steel: Steel, marks: Marks, scene: Scene, tracked: Tracked): number {
  const [cx, cy, cz] = spec.center;
  const [width, height, depth] = spec.size;
  const base = cy - height / 2;
  const top = cy + height / 2;
  const lip = octagon(width, depth, CHAMFER);
  const inner = shrink(width, depth, CHAMFER, RIM);

  const wall = new Mesh(deckPart(lip, undefined, 0, height, tracked), steel.wall);
  wall.position.set(cx, base, cz);
  scene.add(wall);

  const plate = new Mesh(deckPart(inner, undefined, 0, PLATE, tracked), steel.plate);
  plate.position.set(cx, top, cz);
  scene.add(plate);

  const rail = new Mesh(deckPart(lip, inner, 0, RAIL_H, tracked), steel.rail);
  rail.position.set(cx, top, cz);
  scene.add(rail);

  // The cap is the lit strip along the top of the rail, held in from both of the
  // rail's own edges so those edges stay dark and the lip reads as a cut chamfer
  // rather than as a painted line.
  const capGeometry = deckPart(shrink(width, depth, CHAMFER, 0.05), shrink(width, depth, CHAMFER, RIM - 0.05), RAIL_H + 0.004, RAIL_H + 0.004, tracked);
  const cap = new Mesh(capGeometry, steel.cap);
  cap.position.set(cx, top, cz);
  scene.add(cap);

  // Hazard striping without a texture: amber rungs let into the kerb top, with the
  // dark rail between them standing in for the black half of a striped kerb. A striped
  // image is the usual way to draw this and would be the only way to get a true
  // edge-to-edge diagonal, so alternating solids are what the rule leaves. The kerbs
  // that carry no hazard get machined pads at a longer pitch instead, which is what
  // stops a seven-metre rail reading as one extruded bar.
  const sideRun = depth - CHAMFER * 2;
  for (const side of spec.hazard) {
    const rungs = Math.max(2, Math.round(sideRun / 0.62));
    const step = sideRun / rungs;
    for (let index = 0; index < rungs; index += 1) {
      marks.hazard.push({
        x: cx + (side === "left" ? -1 : 1) * (width / 2 - RIM / 2),
        y: top + RAIL_H + 0.035,
        z: cz - sideRun / 2 + (index + 0.5) * step,
        angle: 0,
        length: RIM * 0.66,
        width: step * 0.44,
      });
    }
  }
  const frontRun = width - CHAMFER * 2;
  const plates = Math.max(2, Math.round(frontRun / 1.05));
  const pitch = frontRun / plates;
  for (let index = 0; index < plates; index += 1) {
    for (const side of [-1, 1]) {
      marks.pad.push({
        x: cx - frontRun / 2 + (index + 0.5) * pitch,
        y: top + RAIL_H + 0.035,
        z: cz + side * (depth / 2 - RIM / 2),
        angle: Math.PI / 2,
        length: RIM * 0.66,
        width: pitch * 0.5,
      });
    }
  }
  return top + PLATE;
}

/**
 * One berth's own colour: every material that carries the berth's status, and the group
 * of furniture it wears only while it is closed. Gathering the materials in one list is
 * what stops a berth ending up with a green lamp over a shut lane.
 */
type BerthVisual = { tone: TrackedMaterial[]; offline: Group };

/**
 * One dispatch berth: its lane, the lit segments and gantry lamps that state whether it
 * is running, and the furniture the disruption puts on it when it is not — a barred
 * barrier up its own lane, hatching over the run past it, a cross over the pad no job
 * can stand on, and a warning beacon at the mouth.
 */
function buildBerth(index: number, shapes: Shapes, steel: Steel, deck: number, marks: Marks, cards: Cards, scene: Scene, tracked: Tracked): BerthVisual {
  const x = BERTH_X[index];
  const pad = SITE[index === 0 ? "berth-1" : "berth-2"];

  const lane = new Mesh(shapes.unit, steel.lane);
  lane.scale.set(2.5, 0.03, 5.4);
  lane.position.set(x, deck + 0.015, -0.8);
  scene.add(lane);

  // The lane is bounded by its own light rails rather than by a change of colour
  // alone: at this angle a flat inlay reads as a stain on the deck, and a rail is
  // what makes it read as a channel a block travels down.
  for (const side of [-1, 1]) {
    const rail = new Mesh(shapes.unit, steel.cap);
    rail.scale.set(0.1, 0.08, 5.4);
    rail.position.set(x + side * 1.2, deck + 0.04, -0.8);
    scene.add(rail);
  }

  // The berth states its status down its own rails as a row of lit segments, which is
  // how the mock says a lane is running or shut without printing a word on the floor.
  // They are one instanced mesh because they never move and always agree with each other.
  const pips = keepMaterial(new MeshBasicMaterial({ color: COLORS.live, fog: false }), tracked);
  const pipMesh = new InstancedMesh(shapes.unit, pips, 8);
  const pipPlace = new Matrix4();
  const pipTurn = new Quaternion();
  const pipSize = new Vector3(0.15, 0.05, 0.52);
  const pipAt = new Vector3();
  let pip = 0;
  for (const side of [-1, 1]) {
    for (const z of [-2.9, -1.8, -0.7, 0.4]) {
      pipAt.set(x + side * 1.2, deck + 0.1, z);
      pipMesh.setMatrixAt(pip, pipPlace.compose(pipAt, pipTurn, pipSize));
      pip += 1;
    }
  }
  pipMesh.instanceMatrix.needsUpdate = true;
  scene.add(pipMesh);

  // Direction of travel inside the lane, painted on the deck behind the standing
  // block so the flow still reads when the berth is occupied.
  for (let row = 0; row < 3; row += 1) {
    paintChevron(marks.flow, x, deck + 0.07, -1 - row, 0, 1.15);
  }

  const mast = keepGeometry(new BoxGeometry(0.14, 1.5, 0.14), tracked);
  for (const side of [-1, 1]) {
    const leg = new Mesh(mast, steel.rail);
    leg.position.set(x + side * 1.06, 1.25, -3.4);
    scene.add(leg);
  }
  // A header plate rather than a bare beam: the berth's name is printed on its
  // upper band and its status lights are inset below, which is how the mock says
  // which berth you are looking at without drawing text into the canvas.
  const header = new Mesh(keepGeometry(new BoxGeometry(2.4, 0.62, 0.2), tracked), steel.rail);
  header.position.set(x, 2.1, -3.4);
  scene.add(header);

  // The gantry lamps are round lenses with an additive halo drawn over each one: a lit
  // lamp burns its own middle out to white and throws its colour into the air around it,
  // and a flat coloured plate does neither. Both lamps on a gantry share one lens tone
  // and one halo tone, because they always say the same thing.
  const lens = keepMaterial(new MeshBasicMaterial({ color: COLORS.live, fog: false }), tracked);
  const halo = discTone(COLORS.live, AdditiveBlending, tracked);
  for (const side of [-1, 1]) {
    const lamp = new Mesh(shapes.lamp, lens);
    lamp.position.set(x + side * 0.82, 1.9, -3.28);
    scene.add(lamp);
    face(cards, lamp);
    const flare = new Mesh(shapes.glow, halo);
    flare.position.set(x + side * 0.82, 1.9, -3.1);
    flare.scale.setScalar(0.8);
    scene.add(flare);
    face(cards, flare);
  }

  const offline = new Group();
  offline.name = `berth-${index + 1}-offline`;
  // A dark board carries the padlock and the striped beam over it carries the bars, so
  // the closed berth reads as one barrier rather than as a row of loose slats. The lit
  // cap at each end of the beam is the same lens the gantry uses, in the colour a shut
  // lane is always in.
  const board = new Mesh(
    keepGeometry(new BoxGeometry(2.14, 0.92, 0.07), tracked),
    keepMaterial(new MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.9, metalness: 0.08 }), tracked),
  );
  board.position.set(x, deck + LOCK_Y, BARRIER_Z);
  offline.add(board);

  const beam = new Mesh(keepGeometry(new BoxGeometry(2.42, 0.26, 0.16), tracked), steel.rail);
  beam.position.set(x, deck + 1.02, BARRIER_Z);
  offline.add(beam);

  const stripe = keepMaterial(new MeshBasicMaterial({ color: COLORS.hazard }), tracked);
  for (let slat = 0; slat < 7; slat += 1) {
    const bar = new Mesh(shapes.slat, stripe);
    // Clear of the beam's own front face rather than let into it: a slat that straddles
    // that face flickers as the two surfaces trade places from pixel to pixel.
    bar.position.set(x - 0.9 + slat * 0.3, deck + 1.02, BARRIER_Z + 0.12);
    bar.rotation.z = 0.62;
    offline.add(bar);
  }

  const shut = keepMaterial(new MeshBasicMaterial({ color: COLORS.coral, fog: false }), tracked);
  for (const side of [-1, 1]) {
    const cap = new Mesh(shapes.lamp, shut);
    cap.position.set(x + side * 1.24, deck + 1.02, BARRIER_Z + 0.15);
    cap.scale.setScalar(0.62);
    offline.add(cap);
    face(cards, cap);
  }

  // Two marks with two different jobs: the hatching over the run past the barrier says
  // nothing travels through here, and the cross over the pad says nothing stands here.
  // The hatching rides above the lane's own flow chevrons, because it is laid over the
  // marks it cancels and has to win the depth test against them.
  const sealed: Painted[] = [-3.0, -2.4, -1.8].map((z) => ({ x, y: deck + 0.14, z, angle: Math.PI / 4, length: 1.5, width: 0.17 }));
  buildPainted(sealed, COLORS.pad, 0.4, shapes.decal, offline, tracked);
  const cross: Painted[] = [Math.PI / 4, -Math.PI / 4].map((angle) => ({ x, y: deck + 0.05, z: pad[2], angle, length: 1.32, width: 0.19 }));
  buildPainted(cross, COLORS.coral, 1, shapes.decal, offline, tracked);

  // The beacon at the mouth of the lane is the one mark on this floor that has to be
  // seen from the far side of the frame, so it is a lit head with a halo half again as
  // wide as the head itself rather than a lamp the size of the gantry's.
  const stalk = new Mesh(shapes.post, steel.wall);
  stalk.position.set(x + BEACON_DX, deck + 0.37, BEACON_Z);
  offline.add(stalk);
  const head = new Mesh(shapes.lamp, shut);
  head.position.set(x + BEACON_DX, deck + 0.86, BEACON_Z);
  head.scale.setScalar(1.4);
  offline.add(head);
  face(cards, head);
  const beaconGlow = new Mesh(shapes.glow, discTone(COLORS.coral, AdditiveBlending, tracked));
  beaconGlow.position.set(x + BEACON_DX, deck + 0.86, BEACON_Z + 0.22);
  beaconGlow.scale.setScalar(1.7);
  offline.add(beaconGlow);
  face(cards, beaconGlow);

  offline.visible = false;
  scene.add(offline);
  return { tone: [lens, halo, pips], offline };
}

function applyBerth(visual: BerthVisual, berth: SceneBerth | undefined): void {
  const active = berth?.active ?? true;
  for (const tone of visual.tone) tone.color?.setHex(active ? COLORS.live : COLORS.coral);
  visual.offline.visible = !active;
}

type SpanSpec = { x: number; z: number; length: number; width: number; top: number };

/**
 * A span between two bays: a pier off the ground, a dark run of deck over it, and a
 * kerb down each side. It rides above both kerb rails it joins, because a run at deck
 * level would be buried inside the two bays it is meant to connect. It returns the
 * surface it built, so whatever the span carries is painted onto that geometry instead
 * of at a height guessed from outside.
 */
function buildSpan(spec: SpanSpec, steel: Steel, unit: BoxGeometry, scene: Scene): number {
  const pier = new Mesh(unit, steel.wall);
  pier.scale.set(spec.length * 0.48, spec.top, spec.width * 0.7);
  pier.position.set(spec.x, spec.top / 2, spec.z);
  scene.add(pier);

  const run = new Mesh(unit, steel.lane);
  run.scale.set(spec.length, 0.1, spec.width);
  run.position.set(spec.x, spec.top, spec.z);
  scene.add(run);

  for (const side of [-1, 1]) {
    const kerb = new Mesh(unit, steel.rail);
    kerb.scale.set(spec.length, 0.16, 0.15);
    kerb.position.set(spec.x, spec.top + 0.03, spec.z + side * (spec.width / 2 - 0.075));
    scene.add(kerb);
  }
  return spec.top + 0.05;
}

export function createFlowline3D(canvas: HTMLCanvasElement, initialModel: SceneModel, options: Flowline3DOptions = {}): Flowline3DController {
  const tracked: Tracked = { geometries: new Set(), materials: new Set() };
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: options.preserveDrawingBuffer ?? false });
  } catch {
    throw new Error("WebGL is unavailable in this browser.");
  }
  // Keep the optional explanation layer within the performance plan's 1.25 cap.
  // The DOM timeline remains the playable path when a high-DPR device cannot sustain
  // the floor, so extra pixels are not worth trading against input responsiveness.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setClearColor(COLORS.background, 1);
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.fog = new Fog(COLORS.background, 25, 64);

  // The floor opens on one vantage point, framed so it fills the box: the prep bay at
  // the left edge, the dispatch bay at the right, and the slot strip along the bottom.
  // The camera only moves when a view is chosen, and every such move re-aims the cards
  // and re-projects the anchors, which is what lets every word on this floor stay DOM
  // text. All four views sit on the line they look along, so a run of slot cells
  // projects to a level row instead of a slope.
  const camera = new PerspectiveCamera(34, 1.55, 1, 140);
  camera.position.set(0.4, 11.6, 18.6);
  camera.lookAt(0.4, 1.2, 0.7);
  fitCamera(1.55);
  const cards: Cards = { eye: camera.position, faces: [] };

  /**
   * The floor is far wider than it is deep, so the frame is fitted horizontally:
   * the vertical field follows from the aspect. A narrower canvas then shows the
   * same width of floor and more sky, instead of cropping the outer bays away.
   */
  function fitCamera(aspect: number): void {
    camera.aspect = aspect;
    camera.fov = MathUtils.radToDeg(2 * Math.atan(H_HALF_TAN / aspect));
    camera.updateProjectionMatrix();
  }

  scene.add(new AmbientLight(0x8fc7de, 1.15));
  const key = new DirectionalLight(0xdff6ff, 2.1);
  key.position.set(-7, 11, 9);
  const rim = new DirectionalLight(0x3fb6c8, 0.8);
  rim.position.set(11, 6, -7);
  scene.add(key, rim);

  // The air behind the floor is not empty: a soft glow stands over the dispatch bay
  // and faint ring arcs sweep out from beyond the top right corner, the way a radar
  // screen shows its own sweep. They are cards turned to whichever view is standing and
  // held out of the fog, so they read as light in the air rather than as plant parked in
  // the scene, and the floor still occludes whatever falls below it.
  const sky = new Mesh(fadedDisc(11, 0.34, tracked), discTone(COLORS.glow, AdditiveBlending, tracked));
  sky.position.set(9.4, 1.4, -13.5);
  face(cards, sky);
  scene.add(sky);

  const sweep = keepMaterial(
    new MeshBasicMaterial({ color: COLORS.glow, transparent: true, opacity: 0.22, depthWrite: false, blending: AdditiveBlending, fog: false }),
    tracked,
  );
  for (const radius of [10.5, 14.2, 18.4]) {
    const arc = new Mesh(keepGeometry(new RingGeometry(radius, radius + 0.08, 72, 1, Math.PI * 0.82, Math.PI * 0.6), tracked), sweep);
    arc.position.set(17.5, 6.6, -13.5);
    face(cards, arc);
    scene.add(arc);
  }

  // The deck runs well past the grid, so the floor recedes into the fog instead
  // of ending at a hard edge partway up the frame.
  const deck = new Mesh(
    keepGeometry(new PlaneGeometry(26, 40), tracked),
    keepMaterial(new MeshStandardMaterial({ color: COLORS.deck, roughness: 0.95, metalness: 0.03 }), tracked),
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -0.02;
  scene.add(deck);

  const grid = new GridHelper(26, 26, COLORS.deckLine, COLORS.deckLineFaint);
  grid.position.y = 0.01;
  scene.add(grid);
  tracked.geometries.add(grid.geometry);
  tracked.materials.add(grid.material as TrackedMaterial);

  const shapes: Shapes = {
    slab: keepGeometry(new BoxGeometry(1.9, 0.7, 1.5), tracked),
    cap: keepGeometry(new BoxGeometry(1.98, 0.07, 1.58), tracked),
    meter: keepGeometry(new BoxGeometry(1.4, 0.12, 0.06), tracked),
    // The frame is cut a touch wider than the block's own cap so it reads as a box
    // drawn around the selection rather than as a bead along its edge, and the band
    // behind it is wider and much softer, which is what makes the line look lit.
    frame: selectionRing(2.34, 1.62, 0.15, tracked),
    frameGlow: selectionRing(2.62, 1.9, 0.44, tracked),
    lamp: keepGeometry(new CircleGeometry(0.13, 16), tracked),
    glow: fadedDisc(0.4, 0.85, tracked),
    shadow: fadedDisc(1.5, 0.62, tracked),
    post: keepGeometry(new CylinderGeometry(0.13, 0.17, 0.74, 10), tracked),
    slat: keepGeometry(new BoxGeometry(0.09, 0.24, 0.05), tracked),
    unit: keepGeometry(new BoxGeometry(1, 1, 1), tracked),
    decal: keepGeometry(new BoxGeometry(1, 0.06, 1), tracked),
  };

  // The blocks share every tone that says nothing about which job is standing there,
  // so all five stands are cut from one set. The frame pair is drawn over everything
  // else: a ring hung around a block sits partly inside the bay volume, so a
  // depth-tested frame would have its lower half eaten by the deck and by the block's
  // own front face, and the mock shows a whole box. It is the same mint the floor marks
  // flow in, because both are the view saying "this is the path you asked about".
  const slabTones: SlabTones = {
    track: keepMaterial(new MeshBasicMaterial({ color: 0x0b1a26, fog: false }), tracked),
    frame: keepMaterial(new MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false }), tracked),
    frameGlow: keepMaterial(new MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false, blending: AdditiveBlending, fog: false }), tracked),
    shadow: discTone(0x01080f, NormalBlending, tracked),
  };

  const steel = buildSteel(tracked);
  const marks: Marks = { flow: [], hazard: [], pad: [] };
  const prepDeck = buildPlatform({ center: [-6.6, 0.25, -1], size: [6.6, 0.5, 7.2], hazard: ["left", "right"] }, steel, marks, scene, tracked);
  const dispatchDeck = buildPlatform({ center: [7, 0.25, -1], size: [7.4, 0.5, 7.2], hazard: ["left", "right"] }, steel, marks, scene, tracked);
  // The transfer gate is the one place a job crosses from prep to dispatch, so it
  // stands a little taller than the bays it joins and both spans land on it.
  const gateDeck = buildPlatform({ center: [0, 0.3, 0.2], size: [3.4, 0.6, 3.4], hazard: [] }, steel, marks, scene, tracked);
  const beltTop = buildSpan({ x: -3, z: -0.6, length: 3.6, width: 1.4, top: 0.87 }, steel, shapes.unit, scene);
  buildSpan({ x: 2.6, z: 0.95, length: 2.6, width: 1.15, top: 0.87 }, steel, shapes.unit, scene);

  // The handoff belt states the direction of travel across it; the span on the far
  // side of the gate is left bare, because what travels that one is the route.
  for (let index = 0; index < 3; index += 1) {
    paintChevron(marks.flow, -4.2 + index * 1.2, beltTop + 0.04, -0.6, -Math.PI / 2, 0.78);
  }

  // The prep bay states its own flow twice: up the corridor between the two pads, and
  // across the front apron a job crosses on its way to the belt. The corridor is a dark
  // inlay with a light rail down each side, so its chevrons sit in a channel instead of
  // floating on bare plate. It threads the gap the two staggered pads leave between
  // them, which is why it is shorter than the bay is deep.
  const corridor = new Mesh(shapes.unit, steel.lane);
  corridor.scale.set(1.5, 0.03, 1.35);
  corridor.position.set(-6.65, prepDeck + 0.015, -0.6);
  scene.add(corridor);
  for (const side of [-1, 1]) {
    const rail = new Mesh(shapes.unit, steel.cap);
    rail.scale.set(0.09, 0.08, 1.35);
    rail.position.set(-6.65 + side * 0.71, prepDeck + 0.04, -0.6);
    scene.add(rail);
  }
  for (const z of [-1.02, -0.6, -0.18]) paintChevron(marks.flow, -6.65, prepDeck + 0.05, z, 0, 0.62);
  // The apron pair is sized and centred to the clear run between the bay's front kerb
  // and the near pad's collar, so neither arrow climbs the rail or crosses a socket.
  for (const x of [-8.62, -7.33]) paintArrow(marks.flow, x, prepDeck + 0.05, 1.45, 0.74);

  // Every pad is a socket rather than bare deck: a chamfered collar around the block's
  // own footprint, cut from the same steel as the kerbs, so a block reads as set into
  // the floor rather than as resting on top of it. One collar and one lit lip are
  // instanced across all five pads; only the deck each one stands on changes.
  const padDeck: Record<SlabSite, number> = {
    "prep-a": prepDeck,
    "prep-b": prepDeck,
    gate: gateDeck,
    "berth-1": dispatchDeck,
    "berth-2": dispatchDeck,
  };
  const collarParts: Array<[BufferGeometry, TrackedMaterial]> = [
    [deckPart(octagon(2.34, 1.94, 0.34), shrink(2.34, 1.94, 0.34, 0.18), 0, 0.14, tracked), steel.rail],
    [deckPart(shrink(2.34, 1.94, 0.34, 0.04), shrink(2.34, 1.94, 0.34, 0.14), 0.144, 0.144, tracked), steel.cap],
  ];
  const collarPlace = new Matrix4();
  for (const [geometry, material] of collarParts) {
    const collars = new InstancedMesh(geometry, material, SLAB_SITES.length);
    SLAB_SITES.forEach((site, index) => {
      collars.setMatrixAt(index, collarPlace.makeTranslation(SITE[site][0], padDeck[site], SITE[site][2]));
    });
    collars.instanceMatrix.needsUpdate = true;
    scene.add(collars);
  }

  // One block per job, not one per pad: a job keeps the same block for the whole shift,
  // so when the plan moves it the block travels to its new stand instead of one block
  // going dark on one pad while an identical one lights up on another.
  const slabs = new Map<SceneJob["id"], SlabVisual>(
    initialModel.jobs.map((job) => [job.id, buildSlab(job.id, shapes, slabTones, cards, scene, tracked)]),
  );
  const berths = BERTH_X.map((_, index) => buildBerth(index, shapes, steel, dispatchDeck, marks, cards, scene, tracked));
  buildPainted(marks.flow, COLORS.teal, 0.92, shapes.decal, scene, tracked);
  buildPainted(marks.hazard, COLORS.hazard, 1, shapes.decal, scene, tracked);
  buildPainted(marks.pad, COLORS.pad, 1, shapes.decal, scene, tracked);

  // The slot ruler is one kerb across the front of the floor, grooved into cells, with
  // a coral cell laid over whichever slot the critical deadline falls on. It is built
  // like the bays — a dark wall under a lit plate — but in a colder, darker tone,
  // because it is the deadline rail the floor stands in front of rather than plant.
  const plateIdle = keepMaterial(new MeshStandardMaterial({ color: COLORS.slot, roughness: 0.8, metalness: 0.16 }), tracked);
  const plateDeadline = keepMaterial(new MeshStandardMaterial({ color: COLORS.coral, roughness: 0.48, metalness: 0.12 }), tracked);
  const kerbWall = new Mesh(keepGeometry(new BoxGeometry(SLOT_BAR, SLOT_H, SLOT_D), tracked), keepMaterial(new MeshStandardMaterial({ color: COLORS.slotWall, roughness: 0.86, metalness: 0.14 }), tracked));
  kerbWall.position.set(0, SLOT_H / 2, SLOT_Z);
  scene.add(kerbWall);
  const kerb = new Mesh(keepGeometry(new BoxGeometry(SLOT_BAR, PLATE, SLOT_D - 0.14), tracked), plateIdle);
  kerb.position.set(0, SLOT_H + PLATE / 2, SLOT_Z);
  scene.add(kerb);
  const groove = keepGeometry(new BoxGeometry(0.09, 0.03, SLOT_D - 0.1), tracked);
  const grooveTone = keepMaterial(new MeshBasicMaterial({ color: 0x0d1117 }), tracked);
  const grooves = Array.from({ length: MAX_SLOTS + 1 }, () => {
    const rib = new Mesh(groove, grooveTone);
    rib.position.set(0, SLOT_H + PLATE, SLOT_Z);
    rib.visible = false;
    scene.add(rib);
    return rib;
  });
  const deadlineCell = new Mesh(keepGeometry(new BoxGeometry(1, 0.07, SLOT_D - 0.3), tracked), plateDeadline);
  deadlineCell.position.set(0, SLOT_H + PLATE, SLOT_Z);
  deadlineCell.visible = false;
  scene.add(deadlineCell);

  // WebGL draws a line one pixel wide whatever the material asks for, so a route that
  // has to read as a taped path across the deck is built from boxes: one flat dash per
  // instance, turned to follow its leg of the path. Both are laid in full strength and
  // told apart by rhythm as well as by colour — the committed cause a long coral dash,
  // the proposal a fine mint one — so the ghost reads as a different kind of claim
  // rather than as a dimmer copy of the same one.
  const routes = [
    { color: COLORS.coral, dash: 0.44, gap: 0.26, width: 0.2 },
    { color: COLORS.teal, dash: 0.24, gap: 0.2, width: 0.17 },
  ].map((spec) => {
    const mesh = new InstancedMesh(
      shapes.unit,
      keepMaterial(new MeshBasicMaterial({ color: spec.color, fog: false }), tracked),
      ROUTE_DASHES,
    );
    // An instanced mesh keeps the bounding sphere it was built with, and these are
    // rewritten on every plan change, so culling them by that sphere would drop a
    // route that had moved. There are two of them; drawing them always is cheaper
    // than keeping the sphere correct.
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, dash: spec.dash, gap: spec.gap, width: spec.width };
  });
  type Route = (typeof routes)[number];

  let model = initialModel;
  let anchors: SceneAnchor[] = [];
  let visible = true;
  let disposed = false;
  let animationFrame = 0;
  let animationUntil = 0;
  let animationSpan = LIFT_MS;
  let cameraView: FocusCameraView = "iso";
  let cameraZoom = 1;
  let frameCount = 0;
  let frameSampleCount = 0;
  let frameCursor = 0;
  let lastFrameTime = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  const frameTimes = new Float32Array(720);
  const reducedMotion = Boolean(options.reducedMotion);
  const projected = new Vector3();

  /**
   * A label position, or nothing when the point is behind the camera or outside the
   * frame. Off-frame anchors are dropped rather than clamped: a view that looks past the
   * slot rail should have no slot numbers, not a row of them stacked against one edge,
   * and both the label layer and the pick layer already skip an anchor they do not get.
   */
  function anchorAt(id: string, x: number, y: number, z: number): SceneAnchor | undefined {
    projected.set(x, y, z).project(camera);
    if (projected.z > 1 || Math.abs(projected.x) > 1.04 || Math.abs(projected.y) > 1.04) return undefined;
    return { id, x: (projected.x * 0.5 + 0.5) * 100, y: (-projected.y * 0.5 + 0.5) * 100 };
  }

  function projectAnchors(next: SceneModel): void {
    camera.updateMatrixWorld();
    const slots = Math.min(MAX_SLOTS, next.horizon);
    const list: SceneAnchor[] = [];
    const mark = (id: string, x: number, y: number, z: number) => {
      const anchor = anchorAt(id, x, y, z);
      if (anchor) list.push(anchor);
    };
    // The three bay titles share one band across the top of the frame, above the
    // gantry headers that name the individual berths, and the queue mark sits
    // directly over the gate it counts into. That is the mock's stacking order.
    mark("bay-prep", -6.6, 3.4, -4.6);
    mark("bay-gate", 0, 5.1, 0.2);
    mark("bay-dispatch", 7, 3.4, -4.6);
    // High enough over the gate to clear the label on the block standing in it: at 1.95
    // the two were about forty pixels apart on a 900px canvas, which two stacked lines of
    // text and a chip do not fit into.
    mark("queue", 0, 2.5, 0.2);
    for (const site of SLAB_SITES) {
      // The model is asked where the jobs are, not the geometry: a block part way through
      // a move is between two stands, while its label belongs to the stand the plan has
      // sent it to. The label therefore lands first and the block arrives under it.
      const job = next.jobs.find((entry) => entry.site === site);
      if (!job) continue;
      mark(`site-${site}`, SITE[site][0], SITE[site][1] + 0.42 + (job.selected ? LIFT : 0), SITE[site][2]);
    }
    // The gate callout hangs clear above the gate block, in the gap between the bay
    // titles and the queue mark, and only when a job is actually standing there, so a
    // bubble can never name an empty gate.
    if (next.jobs.some((job) => job.site === "gate")) {
      mark("gate-callout", SITE.gate[0], 3.2, SITE.gate[2]);
    }
    for (let index = 0; index < berths.length; index += 1) {
      // On the upper band of the gantry header, above its own status lights, which
      // is where the mock names each berth. The front apron is left clear: it is
      // the busiest band in the frame, shared by the kerb and the route callouts.
      mark(`berth-${index + 1}`, BERTH_X[index], 2.3, -3.32);
      // A padlock is only meaningful over a shut lane, and it rides on that lane's own
      // barrier — the same numbers the barrier is built from — so the mark cannot
      // drift off the thing it locks.
      if (!(next.berths[index]?.active ?? true)) {
        mark(`lock-${index + 1}`, BERTH_X[index], dispatchDeck + LOCK_Y, BARRIER_Z);
      }
    }
    for (let slot = 1; slot <= slots; slot += 1) {
      mark(`slot-${slot}`, slotX(slot, slots), SLOT_H + PLATE + 0.05, SLOT_Z);
    }
    // On the deck just in front of its own cell, the way the mock hangs it below
    // the kerb. The route callouts sit higher up the deck, so nothing covers it.
    mark("deadline", slotX(Math.min(slots, next.deadlineSlot), slots), 0.06, SLOT_Z + 1.05);
    anchors = list;
    options.onAnchors?.(anchors);
  }

  /**
   * Stand the camera at the current view and zoom. Everything flat that was turned to
   * face the old vantage point is re-aimed and every anchor is re-projected, because a
   * word on this floor is a DOM node placed from that projection rather than something
   * drawn into the canvas: a camera that moved without re-projecting would leave every
   * name behind on the pixels the geometry used to cover.
   */
  function applyView(): void {
    const spec = CAMERA_VIEWS[cameraView];
    const pitch = MathUtils.degToRad(spec.pitch);
    const distance = spec.distance / cameraZoom;
    const [tx, ty, tz] = spec.target;
    camera.position.set(tx, ty + Math.sin(pitch) * distance, tz + Math.cos(pitch) * distance);
    camera.lookAt(tx, ty, tz);
    camera.updateMatrixWorld();
    for (const object of cards.faces) object.lookAt(cards.eye);
    projectAnchors(model);
  }

  /**
   * The path one job's dispatch takes across the open deck: out of the gate, along the
   * front of the berth it is assigned to, and in to the cell on the deadline rail where
   * its dispatch ends. Both the berth and the cell come from that job's own run, so the
   * route states where the plan puts it rather than a shape chosen to look right. It
   * comes forward off the gate before it turns, because the run between the two bays is
   * the only ground it can cross without disappearing under the dispatch deck. The
   * spread lifts a second route clear of the first and tapers away at the rail, so both
   * arrive at their own cell from the same side.
   */
  function routePath(lane: number, endSlot: number, slots: number, spread: number): Vector3[] {
    const berthX = BERTH_X[Math.min(Math.max(lane, 0), BERTH_X.length - 1)];
    const endX = slotX(Math.min(slots, Math.max(1, endSlot)), slots);
    return [
      new Vector3(1.45 - spread * 0.6, ROUTE_Y, 2.2 + spread),
      new Vector3(2.7 - spread * 0.5, ROUTE_Y, 3.0 + spread),
      new Vector3(berthX - 1.2, ROUTE_Y, 3.25 + spread),
      new Vector3(berthX - 0.3, ROUTE_Y, 3.7 + spread),
      new Vector3(endX + spread * 1.2, ROUTE_Y, 4.25 + spread * 0.5),
      new Vector3(endX, ROUTE_Y, SLOT_Z - 0.9),
    ];
  }

  const UP = new Vector3(0, 1, 0);
  const dashPlace = new Matrix4();
  const dashTurn = new Quaternion();
  const dashAt = new Vector3();
  const dashSize = new Vector3();

  /**
   * Lays one route's dashes along a path, in its own rhythm. The walk carries across
   * the corners rather than restarting at each one, so a bend does not produce two
   * dashes back to back, and it starts half a dash in so the route begins on ink.
   */
  function layRoute(route: Route, path: Vector3[] | undefined): void {
    if (!path) {
      route.mesh.count = 0;
      route.mesh.visible = false;
      return;
    }
    const step = route.dash + route.gap;
    dashSize.set(route.dash, 0.05, route.width);
    let along = route.dash / 2;
    let placed = 0;
    for (let leg = 0; leg + 1 < path.length && placed < ROUTE_DASHES; leg += 1) {
      const from = path[leg];
      const to = path[leg + 1];
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const run = Math.hypot(dx, dz);
      if (run < 1e-4) continue;
      // A box scaled along its own X and turned about +Y by this angle points its
      // length at the far end of the leg, which is what makes a dash follow the path.
      dashTurn.setFromAxisAngle(UP, Math.atan2(-dz, dx));
      while (along <= run && placed < ROUTE_DASHES) {
        dashAt.set(from.x + (dx * along) / run, ROUTE_Y, from.z + (dz * along) / run);
        route.mesh.setMatrixAt(placed, dashPlace.compose(dashAt, dashTurn, dashSize));
        placed += 1;
        along += step;
      }
      along -= run;
    }
    route.mesh.count = placed;
    route.mesh.visible = placed > 0;
    route.mesh.instanceMatrix.needsUpdate = true;
  }

  function updateVisuals(next: SceneModel): void {
    model = next;
    const slots = Math.min(MAX_SLOTS, next.horizon);
    let travelling = false;
    for (const [id, slab] of slabs) {
      applySlab(slab, next.jobs.find((job) => job.id === id), reducedMotion);
      travelling = travelling || slab.travel;
    }
    for (let index = 0; index < berths.length; index += 1) applyBerth(berths[index], next.berths[index]);
    // The bar keeps its length; only the grooves that divide its marked run move, so
    // the number of cells always matches the horizon the plan is judged over.
    const cell = SLOT_SPAN / Math.max(1, slots);
    for (let index = 0; index < grooves.length; index += 1) {
      const rib = grooves[index];
      rib.visible = index <= slots;
      if (rib.visible) rib.position.x = -SLOT_SPAN / 2 + index * cell;
    }
    deadlineCell.visible = next.deadlineSlot >= 1 && next.deadlineSlot <= slots;
    if (deadlineCell.visible) {
      deadlineCell.position.x = slotX(next.deadlineSlot, slots);
      deadlineCell.scale.x = Math.max(0.1, cell - 0.16);
    }
    // The routes belong to the job the focus view is built around: the live one traces
    // the plan on the board, and the mint one is only drawn when that same job also has
    // a run in an uncommitted plan, so a ghost path always has a proposal behind it.
    const focus = next.focusJob;
    const ghost = focus ? next.ghostJobs.find((job) => job.id === focus.id) : undefined;
    layRoute(routes[0], focus ? routePath(focus.dispatchLane, focus.dispatchEnd, slots, 0) : undefined);
    layRoute(routes[1], ghost ? routePath(ghost.dispatchLane, ghost.dispatchEnd, slots, 0.55) : undefined);
    projectAnchors(next);
    // A move needs longer than a lift, and both are one window: the frame loop runs while
    // it is open and stops when it closes, so an idle floor still draws nothing.
    animationSpan = travelling ? TRAVEL_MS : LIFT_MS;
    animationUntil = reducedMotion ? 0 : performance.now() + animationSpan;
    settleSlabs(reducedMotion ? 1 : 0);
  }

  /**
   * Put every block where it stands at this point through the current window: along the
   * line from the stand it left to the stand it is going to, hopped over the deck if that
   * is a move, and raised if it is the selected one. The contact shadow follows across
   * the floor rather than through the air, so a lifted block reads as lifted and a
   * travelling one still reads as crossing the deck.
   */
  function settleSlabs(progress: number): void {
    const ease = progress * (2 - progress);
    for (const slab of slabs.values()) {
      if (!slab.group.visible) continue;
      slab.at.lerpVectors(slab.from, slab.to, ease);
      const hop = slab.travel ? Math.sin(Math.PI * ease) * TRAVEL_ARC : 0;
      slab.group.position.set(slab.at.x, slab.at.y + hop + slab.lift * ease, slab.at.z);
      slab.shadow.position.set(slab.at.x + 0.16, slab.at.y - 0.26, slab.at.z - 0.12);
      // The reticle is a card, and a card on a moving block has to be re-aimed as it
      // moves. Only the selected block shows one, so this is at most one aim per frame.
      if (slab.frame.visible) slab.frame.lookAt(cards.eye);
    }
  }

  function renderFrame(now: number): void {
    animationFrame = 0;
    if (disposed || !visible || document.hidden) return;
    if (lastFrameTime > 0) {
      const delta = now - lastFrameTime;
      // A hidden tab or an offscreen pause must not pollute the active-frame
      // sample. 100 ms is well above a normal frame and below a pause gap.
      if (delta > 0 && delta <= 100) {
        frameTimes[frameCursor] = delta;
        frameCursor = (frameCursor + 1) % frameTimes.length;
        frameSampleCount = Math.min(frameSampleCount + 1, frameTimes.length);
      }
    }
    lastFrameTime = now;
    const animating = animationUntil > now;
    if (animating) {
      settleSlabs(Math.min(1, Math.max(0, 1 - (animationUntil - now) / animationSpan)));
    } else {
      settleSlabs(1);
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
    const width = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 960);
    const height = Math.max(1, canvas.clientHeight || canvas.parentElement?.clientHeight || 520);
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    renderer.setSize(width, height, false);
    fitCamera(width / height);
    projectAnchors(model);
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
    setCamera(view, zoom) {
      if (disposed) return;
      cameraView = view;
      cameraZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
      applyView();
      requestRender();
    },
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
    getAnchors() {
      return anchors;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      scene.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.geometry) tracked.geometries.add(mesh.geometry);
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => tracked.materials.add(item as TrackedMaterial));
        else if (material) tracked.materials.add(material as TrackedMaterial);
        // The floor markings hold a per-instance matrix buffer of their own, which
        // is not reached by disposing the geometry they share.
        if (child instanceof InstancedMesh) child.dispose();
      });
      for (const geometry of tracked.geometries) geometry.dispose();
      for (const material of tracked.materials) material.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
