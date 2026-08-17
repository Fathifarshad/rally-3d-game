/**
 * Broad-phase for the world's static obstacles.
 *
 * Everything solid in the scenery (trees, lamp posts, buildings, signs,
 * barriers) registers a circle here. A uniform spatial hash keeps the per-frame
 * query to a handful of candidates no matter how many props the world holds.
 */

export type ColliderKind = 'tree' | 'building' | 'lamp' | 'sign' | 'barrier' | 'prop';

export interface Collider {
  x: number;
  z: number;
  radius: number;
  kind: ColliderKind;
}

export interface CollisionHit {
  collider: Collider;
  /** Unit normal pointing from the obstacle towards the vehicle. */
  nx: number;
  nz: number;
  /** Overlap depth in metres. */
  depth: number;
}

const CELL = 24;

export class CollisionSystem {
  private readonly grid = new Map<number, Collider[]>();
  private readonly all: Collider[] = [];

  add(x: number, z: number, radius: number, kind: ColliderKind): Collider {
    const c: Collider = { x, z, radius, kind };
    this.all.push(c);
    // Register in every cell the circle touches so large buildings still hit.
    const minX = Math.floor((x - radius) / CELL);
    const maxX = Math.floor((x + radius) / CELL);
    const minZ = Math.floor((z - radius) / CELL);
    const maxZ = Math.floor((z + radius) / CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const k = (cx + 4096) * 8192 + (cz + 4096);
        let list = this.grid.get(k);
        if (!list) {
          list = [];
          this.grid.set(k, list);
        }
        list.push(c);
      }
    }
    return c;
  }

  get count(): number {
    return this.all.length;
  }

  /** Nearest overlapping obstacle for a circle, or null. */
  query(x: number, z: number, radius: number): CollisionHit | null {
    let best: CollisionHit | null = null;
    const r0 = Math.floor((x - radius) / CELL);
    const r1 = Math.floor((x + radius) / CELL);
    const c0 = Math.floor((z - radius) / CELL);
    const c1 = Math.floor((z + radius) / CELL);

    for (let cx = r0; cx <= r1; cx++) {
      for (let cz = c0; cz <= c1; cz++) {
        const list = this.grid.get((cx + 4096) * 8192 + (cz + 4096));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          const dx = x - c.x;
          const dz = z - c.z;
          const rr = c.radius + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 0.0001;
          const depth = rr - d;
          if (!best || depth > best.depth) {
            best = { collider: c, nx: dx / d, nz: dz / d, depth };
          }
        }
      }
    }
    return best;
  }

  clear(): void {
    this.grid.clear();
    this.all.length = 0;
  }
}
