import * as THREE from 'three';
import { glowTexture } from '../core/TextureFactory';

/**
 * Procedural "Nissan Z"-style sports coupé.
 *
 * The body is an extruded side silhouette that is then barrel-deformed so the
 * flanks curve and the greenhouse tapers, which is what stops it reading as a
 * box. Everything is grouped so the driving code can steer/spin wheels, roll
 * the body on its suspension and drive the light emissives.
 *
 * If a real GLB is dropped into /public/assets/models/nissan_z.glb the
 * AssetLoader swaps it in and this factory is only used for the traffic cars.
 */

export interface CarRig {
  root: THREE.Group;
  /** Sprung mass: receives pitch/roll from the suspension model. */
  body: THREE.Group;
  /** Steering pivots (front two are steered). Order: FL, FR, RL, RR. */
  wheelPivots: THREE.Object3D[];
  /** Rolling axles inside the pivots. */
  wheelSpins: THREE.Object3D[];
  steeringWheel: THREE.Object3D | null;
  cockpitAnchor: THREE.Object3D;
  paintMaterials: THREE.MeshPhysicalMaterial[];
  brakeLightMaterials: THREE.MeshStandardMaterial[];
  reverseLightMaterials: THREE.MeshStandardMaterial[];
  headlightMaterials: THREE.MeshStandardMaterial[];
  headlightGlows: THREE.Sprite[];
  exhaustAnchors: THREE.Object3D[];
  wheelRadius: number;
  halfWidth: number;
  halfLength: number;
}

const CAR = {
  length: 4.38,
  width: 1.87,
  wheelRadius: 0.35,
  wheelWidth: 0.28,
  frontAxleZ: 1.32,
  rearAxleZ: -1.24,
};

/* ------------------------------------------------------------------ */
/* materials                                                           */
/* ------------------------------------------------------------------ */

export function createPaintMaterial(color: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.7,
    roughness: 0.22,
    clearcoat: 1,
    // A little clear-coat scatter: a perfect mirror finish shows the
    // environment's brightest patch as a hard white panel on flat body sides.
    clearcoatRoughness: 0.10,
    envMapIntensity: 1.15,
  });
}

const matteBlack = () =>
  new THREE.MeshStandardMaterial({ color: 0x121316, metalness: 0.35, roughness: 0.72 });

const glossTrim = () =>
  new THREE.MeshStandardMaterial({ color: 0x08090b, metalness: 0.9, roughness: 0.12, envMapIntensity: 1.4 });

/** Brushed rather than mirror chrome — a perfect mirror flares in the bloom. */
const chrome = () =>
  new THREE.MeshStandardMaterial({ color: 0xa9adb3, metalness: 1, roughness: 0.32, envMapIntensity: 1.2 });

/** Lightly smoked glass: dark enough to hide the cabin's simple geometry. */
const glassMaterial = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0x05080d,
    metalness: 0.1,
    roughness: 0.05,
    transparent: true,
    opacity: 0.82,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
  });

const creamLeather = () =>
  new THREE.MeshStandardMaterial({ color: 0xc9b78f, metalness: 0.02, roughness: 0.66 });

const darkLeather = () =>
  new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.05, roughness: 0.68 });

/* ------------------------------------------------------------------ */
/* body shell                                                          */
/* ------------------------------------------------------------------ */

/** Side silhouette of the lower body, in (length, height). */
function lowerBodyShape(): THREE.Shape {
  const s = new THREE.Shape();
  const L = CAR.length / 2;
  s.moveTo(-L, 0.30);
  s.lineTo(-L + 0.05, 0.72);          // rear bumper
  s.quadraticCurveTo(-L * 0.72, 0.90, -0.55, 0.93); // rear haunch to beltline
  s.lineTo(0.62, 0.90);               // cowl
  s.quadraticCurveTo(L * 0.72, 0.83, L - 0.06, 0.66); // long bonnet dropping to the nose
  s.lineTo(L, 0.40);
  s.lineTo(L - 0.10, 0.20);           // splitter
  s.lineTo(0.9, 0.16);
  s.lineTo(-0.9, 0.16);
  s.lineTo(-L + 0.12, 0.20);
  s.closePath();
  return s;
}

/** Side silhouette of the greenhouse (glass house), in (length, height). */
function cabinShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0.74, 0.90);
  s.quadraticCurveTo(0.44, 1.20, -0.10, 1.26); // windscreen + roof line
  s.lineTo(-0.74, 1.24);
  s.quadraticCurveTo(-1.34, 1.12, -1.64, 0.92); // fastback
  s.lineTo(0.74, 0.90);
  s.closePath();
  return s;
}

/**
 * A thin band that traces the top of the greenhouse. Extruded in body paint it
 * becomes the roof, the A-pillar tops and the rear buttresses in one piece —
 * which is far cleaner than bolting separate pillar boxes onto the cabin.
 */
function roofBandShape(): THREE.Shape {
  const s = new THREE.Shape();
  // outer edge (follows the cabin roof line)
  s.moveTo(0.76, 0.90);
  s.quadraticCurveTo(0.44, 1.21, -0.10, 1.27);
  s.lineTo(-0.74, 1.25);
  s.quadraticCurveTo(-1.35, 1.13, -1.66, 0.90);
  // inner edge (back along the same line, inset by ~11 cm)
  s.lineTo(-1.52, 0.90);
  s.quadraticCurveTo(-1.26, 1.03, -0.72, 1.14);
  s.lineTo(-0.10, 1.16);
  s.quadraticCurveTo(0.36, 1.10, 0.62, 0.90);
  s.closePath();
  return s;
}

/**
 * Extrudes a side profile across the car width and then curves the flanks:
 * `widthAt` narrows the nose/tail, `taperAt` pulls the roof in.
 */
function extrudeProfile(
  shape: THREE.Shape,
  width: number,
  bevel: number,
  widthAt: (z: number) => number,
  taperAt: (y: number) => number,
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 14,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setX(i, x * widthAt(z) * taperAt(y));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function buildShell(paint: THREE.MeshPhysicalMaterial): THREE.Group {
  const g = new THREE.Group();
  const L = CAR.length / 2;

  const bodyGeo = extrudeProfile(
    lowerBodyShape(),
    CAR.width,
    0.05,
    (z) => {
      const t = Math.min(1, Math.abs(z) / L);
      return 1 - 0.30 * t * t * t;      // pinch the extremities
    },
    (y) => 1 - 0.06 * Math.max(0, y - 0.5),
  );
  const bodyMesh = new THREE.Mesh(bodyGeo, paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  g.add(bodyMesh);

  // Greenhouse glass, inset from the body sides.
  const cabinGlass = extrudeProfile(
    cabinShape(),
    CAR.width * 0.84,
    0.02,
    () => 1,
    (y) => 1 - 0.20 * Math.max(0, y - 0.95),
  );
  const glass = new THREE.Mesh(cabinGlass, glassMaterial());
  glass.renderOrder = 2;
  g.add(glass);

  // Painted roof: one extruded band over the top of the greenhouse.
  const roofGeo = extrudeProfile(
    roofBandShape(),
    CAR.width * 0.855,
    0.015,
    () => 1,
    (y) => 1 - 0.20 * Math.max(0, y - 0.95),
  );
  const roof = new THREE.Mesh(roofGeo, paint);
  roof.castShadow = true;
  g.add(roof);

  // Beltline trim that visually separates body from glass.
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(CAR.width * 0.90, 0.045, 2.5),
    glossTrim(),
  );
  belt.position.set(0, 0.905, -0.42);
  g.add(belt);

  // Bonnet power bulge.
  const bulge = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 1.05), paint);
  bulge.position.set(0, 0.885, 1.16);
  bulge.rotation.x = 0.05;
  g.add(bulge);

  // Front bumper, grille and splitter.
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.36, 0.16), matteBlack());
  grille.position.set(0, 0.44, L - 0.03);
  g.add(grille);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.05, 0.44), matteBlack());
  splitter.position.set(0, 0.19, L - 0.16);
  g.add(splitter);

  [-1, 1].forEach((s) => {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.12), matteBlack());
    intake.position.set(s * 0.66, 0.32, L - 0.06);
    g.add(intake);
  });

  // Rear diffuser + valance.
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.20, 0.30), matteBlack());
  diffuser.position.set(0, 0.26, -L + 0.10);
  g.add(diffuser);

  // Ducktail lip.
  const lip = new THREE.Mesh(new THREE.BoxGeometry(CAR.width * 0.72, 0.045, 0.22), paint);
  lip.position.set(0, 0.935, -L + 0.26);
  lip.rotation.x = -0.09;
  g.add(lip);

  // Side skirts.
  [-1, 1].forEach((s) => {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 2.1), matteBlack());
    skirt.position.set(s * (CAR.width / 2 - 0.06), 0.24, -0.05);
    g.add(skirt);
  });

  // Mirrors.
  [-1, 1].forEach((s) => {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), glossTrim());
    stalk.position.set(s * (CAR.width / 2 - 0.02), 0.99, 0.52);
    g.add(stalk);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.11, 0.20), paint);
    cap.position.set(s * (CAR.width / 2 + 0.09), 1.0, 0.50);
    cap.rotation.y = s * 0.16;
    cap.castShadow = true;
    g.add(cap);
  });

  // Door handles.
  [-1, 1].forEach((s) => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.20), chrome());
    h.position.set(s * (CAR.width / 2 - 0.04), 0.83, -0.20);
    g.add(h);
  });

  return g;
}

/* ------------------------------------------------------------------ */
/* lights                                                              */
/* ------------------------------------------------------------------ */

interface LightSet {
  head: THREE.MeshStandardMaterial[];
  brake: THREE.MeshStandardMaterial[];
  reverse: THREE.MeshStandardMaterial[];
  glows: THREE.Sprite[];
}

function buildLights(g: THREE.Group): LightSet {
  const L = CAR.length / 2;
  const head: THREE.MeshStandardMaterial[] = [];
  const brake: THREE.MeshStandardMaterial[] = [];
  const reverse: THREE.MeshStandardMaterial[] = [];
  const glows: THREE.Sprite[] = [];

  // Daylight racing: the lamps read as lit lenses, not as light sources.
  // Over-driving these blows out into the bloom pass and washes the car white.
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xdfe9ff,
    emissive: 0xbcd4ff,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0,
  });
  head.push(headMat);

  const lensGeo = new THREE.BoxGeometry(0.46, 0.12, 0.10);
  [-1, 1].forEach((s) => {
    const lamp = new THREE.Mesh(lensGeo, headMat);
    lamp.position.set(s * 0.60, 0.62, L - 0.10);
    g.add(lamp);

    // Twin-ring LED signature (the Z's teardrop lamps).
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.075, 0.016, 8, 20),
      headMat,
    );
    ring.position.set(s * 0.60, 0.62, L - 0.05);
    g.add(ring);

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xbfd8ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.28,
      }),
    );
    sprite.scale.set(0.62, 0.62, 1);
    sprite.position.set(s * 0.60, 0.62, L + 0.02);
    g.add(sprite);
    glows.push(sprite);
  });

  // Full-width rear light bar with two "boomerang" lenses.
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x40060c,
    emissive: 0xff1e2d,
    emissiveIntensity: 1.1,
    roughness: 0.3,
    metalness: 0,
  });
  brake.push(tailMat);

  const bar = new THREE.Mesh(new THREE.BoxGeometry(CAR.width * 0.86, 0.035, 0.06), tailMat);
  bar.position.set(0, 0.80, -L + 0.02);
  g.add(bar);

  [-1, 1].forEach((s) => {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.08), tailMat);
    lens.position.set(s * 0.56, 0.80, -L + 0.02);
    g.add(lens);
  });

  const revMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.4,
  });
  reverse.push(revMat);
  [-1, 1].forEach((s) => {
    const rev = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.05), revMat);
    rev.position.set(s * 0.28, 0.70, -L + 0.04);
    g.add(rev);
  });

  return { head, brake, reverse, glows };
}

/* ------------------------------------------------------------------ */
/* wheels                                                              */
/* ------------------------------------------------------------------ */

let tyreGeo: THREE.BufferGeometry | null = null;
let rimGeo: THREE.BufferGeometry | null = null;
let spokeGeo: THREE.BufferGeometry | null = null;
let discGeo: THREE.BufferGeometry | null = null;

/**
 * Wheel geometry is shared by every wheel on every car.
 *
 * The tyre is an *open* cylinder (tread band only) and the rim sits a few
 * millimetres proud of it — a closed tyre cylinder would swallow the rim and
 * every wheel would render as a plain black disc.
 */
function wheelGeometries() {
  if (!tyreGeo) {
    const R = CAR.wheelRadius;
    const W = CAR.wheelWidth;
    tyreGeo = new THREE.CylinderGeometry(R, R, W, 26, 1, true);
    tyreGeo.rotateZ(Math.PI / 2);

    // Sidewall: a flat ring closing the gap between tread and rim.
    rimGeo = new THREE.RingGeometry(R * 0.79, R * 0.995, 26);
    rimGeo.rotateY(Math.PI / 2);

    // Long spokes reaching almost to the rim lip, so the wheel reads as an
    // open alloy rather than a hubcap.
    spokeGeo = new THREE.BoxGeometry(0.055, R * 0.72, 0.085);
    discGeo = new THREE.CylinderGeometry(R * 0.79, R * 0.79, W * 1.04, 24, 1);
    discGeo.rotateZ(Math.PI / 2);
  }
  return { tyre: tyreGeo!, sidewall: rimGeo!, spoke: spokeGeo!, hub: discGeo! };
}

function buildWheel(side: number, sporty: boolean): THREE.Group {
  const { tyre, sidewall, spoke, hub } = wheelGeometries();
  const wheel = new THREE.Group();
  const R = CAR.wheelRadius;
  const W = CAR.wheelWidth;
  const outer = (side >= 0 ? 1 : -1) * (W / 2);

  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x111114,
    roughness: 0.94,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const tread = new THREE.Mesh(tyre, tyreMat);
  tread.castShadow = true;
  wheel.add(tread);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x16171a,
    roughness: 0.88,
    side: THREE.DoubleSide,
  });
  [1, -1].forEach((s) => {
    const wall = new THREE.Mesh(sidewall, wallMat);
    wall.position.x = s * (W / 2 - 0.001);
    wheel.add(wall);
  });

  // The barrel face is kept dark so it reads as the shadow *between* the
  // spokes; the spokes themselves are the bright graphite part.
  const rimMat = new THREE.MeshStandardMaterial({
    color: sporty ? 0x1b1e22 : 0x7d838a,
    metalness: 0.9,
    roughness: sporty ? 0.42 : 0.4,
    envMapIntensity: 1.1,
  });
  wheel.add(new THREE.Mesh(hub, rimMat));

  const spokeMat = new THREE.MeshStandardMaterial({
    color: sporty ? 0x8d949c : 0xb6bcc4,
    metalness: 0.92,
    roughness: 0.28,
    envMapIntensity: 1.5,
  });
  const spokeCount = sporty ? 5 : 6;
  for (let i = 0; i < spokeCount; i++) {
    const a = (i / spokeCount) * Math.PI * 2;
    const s = new THREE.Mesh(spoke, spokeMat);
    s.position.set(
      outer + (side >= 0 ? 0.014 : -0.014),
      Math.cos(a) * R * 0.36,
      Math.sin(a) * R * 0.36,
    );
    s.rotation.x = -a;
    wheel.add(s);
  }

  // Centre cap.
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.16, R * 0.16, 0.03, 14),
    new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.35 }),
  );
  cap.rotation.z = Math.PI / 2;
  cap.position.x = outer + (side >= 0 ? 0.02 : -0.02);
  wheel.add(cap);

  if (sporty) {
    // Brake disc + red caliper, visible through the spokes.
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.60, R * 0.60, 0.028, 20),
      new THREE.MeshStandardMaterial({ color: 0x5c6066, metalness: 1, roughness: 0.5 }),
    );
    disc.rotation.z = Math.PI / 2;
    disc.position.x = outer - (side >= 0 ? 0.06 : -0.06);
    wheel.add(disc);

    const caliper = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.17, 0.09),
      new THREE.MeshStandardMaterial({ color: 0xc41f2e, metalness: 0.4, roughness: 0.4 }),
    );
    caliper.position.set(outer - (side >= 0 ? 0.08 : -0.08), 0, -R * 0.45);
    wheel.add(caliper);
  }

  return wheel;
}

/* ------------------------------------------------------------------ */
/* interior                                                            */
/* ------------------------------------------------------------------ */

function buildInterior(g: THREE.Group): THREE.Object3D | null {
  const cream = creamLeather();
  const dark = darkLeather();

  // Floor + rear bulkhead so you never see through the cabin.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.05, 2.0), dark);
  floor.position.set(0, 0.60, -0.15);
  g.add(floor);

  const bulk = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.42, 0.08), cream);
  bulk.position.set(0, 0.82, -1.02);
  g.add(bulk);

  // Dashboard: dark top, cream lower face.
  const dashTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.10, 0.46), dark);
  dashTop.position.set(0, 0.94, 0.62);
  dashTop.rotation.x = 0.12;
  g.add(dashTop);

  // Dark dash face with a cream accent strip: a full-width cream panel this
  // close to the cockpit camera reads as a white wall.
  const dashFace = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.22, 0.10), dark);
  dashFace.position.set(0, 0.85, 0.44);
  g.add(dashFace);

  const dashAccent = new THREE.Mesh(new THREE.BoxGeometry(1.40, 0.045, 0.04), cream);
  dashAccent.position.set(0, 0.79, 0.47);
  g.add(dashAccent);

  // Instrument binnacle + centre screen (emissive so it glows at night).
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d12,
    emissive: 0x2a6cff,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.03), screenMat);
  cluster.position.set(-0.36, 0.95, 0.44);
  cluster.rotation.x = -0.22;
  g.add(cluster);

  // Binnacle hood over the cluster — the first thing you see from the seat.
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.22), dark);
  hood.position.set(-0.36, 1.04, 0.46);
  hood.rotation.x = 0.18;
  g.add(hood);

  const centre = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.18, 0.03), screenMat);
  centre.position.set(0, 0.92, 0.42);
  centre.rotation.x = -0.15;
  g.add(centre);

  // Triple pod gauges on top of the dash — a Z signature.
  [-0.1, 0, 0.1].forEach((dx) => {
    const pod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12),
      dark,
    );
    pod.rotation.x = Math.PI / 2 - 0.3;
    pod.position.set(dx, 1.02, 0.5);
    g.add(pod);
  });

  // Centre console + gear lever.
  const console = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.9), dark);
  console.position.set(0, 0.70, 0.05);
  g.add(console);

  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.20, 8), chrome());
  lever.position.set(0, 0.86, 0.22);
  g.add(lever);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), cream);
  knob.position.set(0, 0.96, 0.22);
  g.add(knob);

  // Sport seats: cushion, backrest, bolsters, headrest.
  const seat = (x: number) => {
    const s = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.10, 0.50), cream);
    base.position.set(0, 0.68, -0.28);
    s.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.11), cream);
    back.position.set(0, 0.97, -0.54);
    back.rotation.x = -0.22;
    s.add(back);
    [-1, 1].forEach((b) => {
      const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.56, 0.16), cream);
      bolster.position.set(b * 0.21, 0.97, -0.50);
      bolster.rotation.x = -0.22;
      s.add(bolster);
    });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.20, 0.12), cream);
    head.position.set(0, 1.28, -0.63);
    s.add(head);
    s.position.x = x;
    return s;
  };
  g.add(seat(-0.38));
  g.add(seat(0.38));

  // Door cards in cream so the interior colour reads from outside too.
  [-1, 1].forEach((s) => {
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 1.3), cream);
    card.position.set(s * 0.72, 0.82, -0.1);
    g.add(card);
  });

  // Steering wheel assembly (returned so it can be turned).
  const steer = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.024, 10, 26), dark);
  steer.add(rim);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.15, 0.02), cream);
    spoke.position.set(Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0);
    spoke.rotation.z = a - Math.PI / 2;
    steer.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), dark);
  hub.rotation.x = Math.PI / 2;
  steer.add(hub);
  steer.position.set(-0.36, 0.90, 0.30);
  steer.rotation.x = -0.42;
  g.add(steer);

  return steer;
}

/* ------------------------------------------------------------------ */
/* public factory                                                      */
/* ------------------------------------------------------------------ */

export function createPlayerCar(paintColor = 0x05060a): CarRig {
  const root = new THREE.Group();
  root.name = 'nissan-z';

  const body = new THREE.Group();
  root.add(body);

  const paint = createPaintMaterial(paintColor);
  const shell = buildShell(paint);
  body.add(shell);

  const lights = buildLights(body);
  const steeringWheel = buildInterior(body);

  // Exhaust tips.
  const exhaustAnchors: THREE.Object3D[] = [];
  [-1, 1].forEach((s) => {
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.065, 0.20, 14),
      chrome(),
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.set(s * 0.46, 0.32, -CAR.length / 2 + 0.02);
    body.add(tip);
    const anchor = new THREE.Object3D();
    anchor.position.set(s * 0.46, 0.32, -CAR.length / 2 - 0.06);
    body.add(anchor);
    exhaustAnchors.push(anchor);
  });

  // Wheels
  const wheelPivots: THREE.Object3D[] = [];
  const wheelSpins: THREE.Object3D[] = [];
  const layout: Array<[number, number]> = [
    [-1, CAR.frontAxleZ],
    [1, CAR.frontAxleZ],
    [-1, CAR.rearAxleZ],
    [1, CAR.rearAxleZ],
  ];
  const archMat = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 1 });
  layout.forEach(([sx, z]) => {
    const pivot = new THREE.Object3D();
    // Wheels sit flush with the widest point of the body for a planted stance.
    pivot.position.set(sx * (CAR.width / 2 - 0.02), CAR.wheelRadius, z);
    const spin = new THREE.Object3D();
    spin.add(buildWheel(sx, true));
    pivot.add(spin);
    root.add(pivot);
    wheelPivots.push(pivot);
    wheelSpins.push(spin);

    // Dark arch liner tucked inside the bodywork so the wheel wells read as
    // shadow instead of showing daylight through the car.
    const arch = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.78), archMat);
    arch.position.set(sx * (CAR.width / 2 - 0.24), CAR.wheelRadius + 0.24, z);
    body.add(arch);
  });

  // Driver's eye point (left-hand drive). Sitting a little behind the wheel
  // keeps the dashboard, the rim and the A-pillar in frame, which is what
  // makes the cockpit camera read as a cockpit rather than a floating view.
  const cockpitAnchor = new THREE.Object3D();
  cockpitAnchor.position.set(-0.36, 1.19, -0.26);
  body.add(cockpitAnchor);

  return {
    root,
    body,
    wheelPivots,
    wheelSpins,
    steeringWheel,
    cockpitAnchor,
    paintMaterials: [paint],
    brakeLightMaterials: lights.brake,
    reverseLightMaterials: lights.reverse,
    headlightMaterials: lights.head,
    headlightGlows: lights.glows,
    exhaustAnchors,
    wheelRadius: CAR.wheelRadius,
    halfWidth: CAR.width / 2,
    halfLength: CAR.length / 2,
  };
}

/* ------------------------------------------------------------------ */
/* traffic cars — cheap, shared geometry                               */
/* ------------------------------------------------------------------ */

let npcGeoCache: {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  lamp: THREE.BufferGeometry;
} | null = null;

function npcGeometries() {
  if (!npcGeoCache) {
    const body = new THREE.BoxGeometry(1.82, 0.72, 4.3);
    const cabin = new THREE.BoxGeometry(1.62, 0.60, 2.1);
    const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14);
    wheel.rotateZ(Math.PI / 2);
    const lamp = new THREE.BoxGeometry(0.34, 0.10, 0.06);
    npcGeoCache = { body, cabin, wheel, lamp };
  }
  return npcGeoCache;
}

export interface NpcRig {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  tailMaterial: THREE.MeshStandardMaterial;
}

export function createTrafficCar(color: number): NpcRig {
  const { body, cabin, wheel, lamp } = npcGeometries();
  const root = new THREE.Group();

  const paint = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.7,
    roughness: 0.34,
    envMapIntensity: 1.1,
  });
  const b = new THREE.Mesh(body, paint);
  b.position.y = 0.72;
  b.castShadow = true;
  root.add(b);

  const c = new THREE.Mesh(cabin, new THREE.MeshStandardMaterial({
    color: 0x14181f,
    metalness: 0.3,
    roughness: 0.18,
    envMapIntensity: 1.4,
  }));
  c.position.set(0, 1.32, -0.25);
  root.add(c);

  const tailMaterial = new THREE.MeshStandardMaterial({
    color: 0x39070c,
    emissive: 0xff2233,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });

  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff0d0,
    emissiveIntensity: 1.6,
  });
  [-1, 1].forEach((s) => {
    const t = new THREE.Mesh(lamp, tailMaterial);
    t.position.set(s * 0.6, 0.86, -2.16);
    root.add(t);
    const h = new THREE.Mesh(lamp, headMat);
    h.position.set(s * 0.6, 0.80, 2.16);
    root.add(h);
  });

  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.95 });
  const wheels: THREE.Object3D[] = [];
  ([[-1, 1.4], [1, 1.4], [-1, -1.4], [1, -1.4]] as Array<[number, number]>).forEach(([sx, z]) => {
    const w = new THREE.Mesh(wheel, tyreMat);
    w.position.set(sx * 0.86, 0.34, z);
    root.add(w);
    wheels.push(w);
  });

  return { root, wheels, tailMaterial };
}
