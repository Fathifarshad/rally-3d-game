import * as THREE from 'three';
import { TRACK } from '../game/Config';
import { createRandom } from '../core/MathUtils';
import { terrainHeight } from './Terrain';
import { grassTexture, roadRoughnessTexture, roadTexture } from '../core/TextureFactory';

export interface TrackFrame {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  side: THREE.Vector3;
}

export interface Projection {
  /** Arc-length position along the racing line, in metres. */
  distance: number;
  /** Signed offset from the centre line: positive is the right-hand side. */
  lateral: number;
  index: number;
}

export type ZoneKind = 'city' | 'forest' | 'mountain' | 'plain';

const CELL = 30;
const SAMPLE_STEP = 2; // metres between cached frames

/**
 * The track is the backbone of the whole game: the road mesh, prop scattering,
 * traffic AI, checkpoints, lap timing and the mini-map all read from it.
 * It caches evenly spaced frames along a closed Catmull-Rom spline plus a
 * uniform spatial grid, so "where am I on the road?" is an O(1) lookup that
 * can be called many times per frame.
 */
export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly halfWidth = TRACK.halfWidth;
  readonly totalLength: number;
  readonly sampleCount: number;

  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly dx: Float32Array;
  private readonly dz: Float32Array;
  private readonly dists: Float32Array;
  private readonly grid = new Map<number, number[]>();

  readonly checkpointDistances: number[] = [];

  constructor(seed = 20260815) {
    const rand = createRandom(seed);
    const controls: THREE.Vector3[] = [];
    const CP = 26;
    const baseR = 540;
    for (let i = 0; i < CP; i++) {
      const a = (i / CP) * Math.PI * 2;
      const r =
        baseR *
        (1 + 0.26 * Math.sin(a * 3 + 1.1) + 0.15 * Math.cos(a * 5 + 0.4) + (rand() - 0.5) * 0.05);
      const x = Math.cos(a) * r * 1.24;
      const z = Math.sin(a) * r * 0.92;
      controls.push(new THREE.Vector3(x, terrainHeight(x, z), z));
    }

    this.curve = new THREE.CatmullRomCurve3(controls, true, 'catmullrom', 0.5);
    this.curve.arcLengthDivisions = 6000;
    this.totalLength = this.curve.getLength();

    this.sampleCount = Math.max(64, Math.round(this.totalLength / SAMPLE_STEP));
    const n = this.sampleCount;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.dx = new Float32Array(n);
    this.dz = new Float32Array(n);
    this.dists = new Float32Array(n);

    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = i / n;
      this.curve.getPointAt(u, p);
      // Snap the racing line onto the same height field the terrain uses.
      this.px[i] = p.x;
      this.pz[i] = p.z;
      this.py[i] = terrainHeight(p.x, p.z);
      this.dists[i] = (u * this.totalLength);
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      let vx = this.px[b] - this.px[a];
      let vz = this.pz[b] - this.pz[a];
      const len = Math.hypot(vx, vz) || 1;
      vx /= len;
      vz /= len;
      this.dx[i] = vx;
      this.dz[i] = vz;
    }

    for (let i = 0; i < n; i++) {
      const key = this.cellKey(this.px[i], this.pz[i]);
      let list = this.grid.get(key);
      if (!list) {
        list = [];
        this.grid.set(key, list);
      }
      list.push(i);
    }

    for (let i = 0; i < TRACK.checkpointCount; i++) {
      this.checkpointDistances.push((i / TRACK.checkpointCount) * this.totalLength);
    }
  }

  private cellKey(x: number, z: number): number {
    const cx = Math.floor(x / CELL) + 4096;
    const cz = Math.floor(z / CELL) + 4096;
    return cx * 8192 + cz;
  }

  indexAtDistance(distance: number): number {
    const d = this.wrapDistance(distance);
    return Math.min(this.sampleCount - 1, Math.floor((d / this.totalLength) * this.sampleCount));
  }

  wrapDistance(distance: number): number {
    const L = this.totalLength;
    let d = distance % L;
    if (d < 0) d += L;
    return d;
  }

  /** Shortest signed difference a - b along the closed loop. */
  deltaDistance(a: number, b: number): number {
    const L = this.totalLength;
    let d = (a - b) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  frameAt(distance: number, out: TrackFrame): TrackFrame {
    const n = this.sampleCount;
    const d = this.wrapDistance(distance);
    const f = (d / this.totalLength) * n;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const t = f - Math.floor(f);

    const x = this.px[i0] + (this.px[i1] - this.px[i0]) * t;
    const z = this.pz[i0] + (this.pz[i1] - this.pz[i0]) * t;
    out.pos.set(x, terrainHeight(x, z), z);

    let vx = this.dx[i0] + (this.dx[i1] - this.dx[i0]) * t;
    let vz = this.dz[i0] + (this.dz[i1] - this.dz[i0]) * t;
    const l = Math.hypot(vx, vz) || 1;
    vx /= l;
    vz /= l;
    out.dir.set(vx, 0, vz);
    // Right-hand side vector (dir rotated -90° about +Y).
    out.side.set(vz, 0, -vx);
    return out;
  }

  /** World position for a given arc length + lateral offset. */
  positionAt(distance: number, lateral: number, out: THREE.Vector3): THREE.Vector3 {
    const f = TMP_FRAME;
    this.frameAt(distance, f);
    out.copy(f.pos).addScaledVector(f.side, lateral);
    out.y = terrainHeight(out.x, out.z);
    return out;
  }

  /** Heading (yaw) of the road at a distance, matching Object3D.rotation.y. */
  headingAt(distance: number): number {
    const f = TMP_FRAME;
    this.frameAt(distance, f);
    return Math.atan2(f.dir.x, f.dir.z);
  }

  /** Curvature magnitude used by the traffic AI and the camera shake. */
  curvatureAt(distance: number): number {
    const a = this.headingAt(distance - 12);
    const b = this.headingAt(distance + 12);
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d / 24;
  }

  project(x: number, z: number, out?: Projection): Projection {
    const result: Projection = out ?? { distance: 0, lateral: 0, index: 0 };
    let best = -1;
    let bestD2 = Infinity;

    for (let ring = 1; ring <= 4 && best < 0; ring++) {
      for (let ox = -ring; ox <= ring; ox++) {
        for (let oz = -ring; oz <= ring; oz++) {
          // Only walk the newly added ring after the first pass.
          if (ring > 1 && Math.max(Math.abs(ox), Math.abs(oz)) !== ring) continue;
          const list = this.grid.get(this.cellKey(x + ox * CELL, z + oz * CELL));
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const i = list[k];
            const ddx = x - this.px[i];
            const ddz = z - this.pz[i];
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = i;
            }
          }
        }
      }
    }

    if (best < 0) {
      // Far outside the mapped area — fall back to a linear scan (rare).
      for (let i = 0; i < this.sampleCount; i += 4) {
        const ddx = x - this.px[i];
        const ddz = z - this.pz[i];
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    }

    const i = best;
    const rx = x - this.px[i];
    const rz = z - this.pz[i];
    const along = rx * this.dx[i] + rz * this.dz[i];
    const lateral = rx * this.dz[i] + rz * -this.dx[i];

    result.index = i;
    result.distance = this.wrapDistance(this.dists[i] + along);
    result.lateral = lateral;
    return result;
  }

  /** Which flavour of scenery belongs at this point of the lap. */
  zoneAt(distance: number): ZoneKind {
    const t = this.wrapDistance(distance) / this.totalLength;
    if (t < 0.2) return 'city';
    if (t < 0.42) return 'forest';
    if (t < 0.58) return 'plain';
    if (t < 0.78) return 'mountain';
    if (t < 0.9) return 'forest';
    return 'city';
  }

  /** Lane centre offsets: negative = oncoming side, positive = player side. */
  laneOffset(lane: number): number {
    const laneW = (this.halfWidth * 2) / TRACK.laneCount;
    return -this.halfWidth + laneW * (lane + 0.5);
  }

  /**
   * Builds the tarmac ribbon plus the grass verge that blends the road into
   * the coarse terrain mesh. Both are single draw calls.
   */
  buildRoadMesh(anisotropy: number): THREE.Group {
    const group = new THREE.Group();
    group.name = 'road';

    const n = this.sampleCount;
    const segs = n; // closed loop: repeat the first frame at the end
    const roadPos: number[] = [];
    const roadUv: number[] = [];
    const roadNorm: number[] = [];
    const vergePos: number[] = [];
    const vergeUv: number[] = [];
    const vergeNorm: number[] = [];

    const frame: TrackFrame = {
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      side: new THREE.Vector3(),
    };

    const HW = this.halfWidth;
    const VERGE = 34;
    const ROAD_LIFT = 0.14;

    for (let i = 0; i <= segs; i++) {
      const idx = i % n;
      const d = this.dists[idx] + (i === segs ? this.totalLength : 0);
      this.frameAt(this.dists[idx], frame);
      const v = d / 14;

      const lx = frame.pos.x - frame.side.x * HW;
      const lz = frame.pos.z - frame.side.z * HW;
      const rx = frame.pos.x + frame.side.x * HW;
      const rz = frame.pos.z + frame.side.z * HW;

      roadPos.push(lx, terrainHeight(lx, lz) + ROAD_LIFT, lz);
      roadPos.push(rx, terrainHeight(rx, rz) + ROAD_LIFT, rz);
      roadUv.push(0, v, 1, v);
      roadNorm.push(0, 1, 0, 0, 1, 0);

      // Verge: four strips (outer-left, inner-left, inner-right, outer-right)
      const vlx = frame.pos.x - frame.side.x * (HW + VERGE);
      const vlz = frame.pos.z - frame.side.z * (HW + VERGE);
      const vrx = frame.pos.x + frame.side.x * (HW + VERGE);
      const vrz = frame.pos.z + frame.side.z * (HW + VERGE);

      vergePos.push(vlx, terrainHeight(vlx, vlz) - 0.15, vlz);
      vergePos.push(lx, terrainHeight(lx, lz) + ROAD_LIFT - 0.03, lz);
      vergePos.push(rx, terrainHeight(rx, rz) + ROAD_LIFT - 0.03, rz);
      vergePos.push(vrx, terrainHeight(vrx, vrz) - 0.15, vrz);
      const gv = d / 24;
      vergeUv.push(0, gv, 1, gv, 1.2, gv, 2.2, gv);
      vergeNorm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    }

    // Winding matters: these ribbons are single-sided and their normals point
    // up, so the triangles must be counter-clockwise seen from above.
    const roadIdx: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      roadIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const vergeIdx: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = i * 4;
      const b = (i + 1) * 4;
      // left strip and right strip only (the middle is the tarmac itself)
      vergeIdx.push(a, b, a + 1, a + 1, b, b + 1);
      vergeIdx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUv, 2));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNorm, 3));
    roadGeo.setIndex(roadIdx);
    roadGeo.computeBoundingSphere();

    const map = roadTexture();
    const rough = roadRoughnessTexture();
    map.anisotropy = anisotropy;
    rough.anisotropy = anisotropy;
    const roadMat = new THREE.MeshStandardMaterial({
      map,
      roughnessMap: rough,
      roughness: 0.82,
      metalness: 0.04,
      envMapIntensity: 0.5,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    roadMesh.matrixAutoUpdate = false;
    group.add(roadMesh);

    const vergeGeo = new THREE.BufferGeometry();
    vergeGeo.setAttribute('position', new THREE.Float32BufferAttribute(vergePos, 3));
    vergeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(vergeUv, 2));
    vergeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(vergeNorm, 3));
    vergeGeo.setIndex(vergeIdx);
    vergeGeo.computeBoundingSphere();

    const grass = grassTexture([4, 1]);
    grass.anisotropy = anisotropy;
    const vergeMat = new THREE.MeshStandardMaterial({
      map: grass,
      roughness: 1,
      metalness: 0,
      color: 0x9fae8e,
    });
    const vergeMesh = new THREE.Mesh(vergeGeo, vergeMat);
    vergeMesh.receiveShadow = true;
    vergeMesh.matrixAutoUpdate = false;
    group.add(vergeMesh);

    return group;
  }

  /** Flat XZ outline used by the mini-map. */
  getMiniMapPath(step = 8): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < this.sampleCount; i += step) pts.push([this.px[i], this.pz[i]]);
    pts.push([this.px[0], this.pz[0]]);
    return pts;
  }
}

const TMP_FRAME: TrackFrame = {
  pos: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  side: new THREE.Vector3(),
};
