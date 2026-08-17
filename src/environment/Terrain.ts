/**
 * A single analytic height field drives both the terrain mesh and the racing
 * line elevation, which guarantees the road always sits on the ground.
 * Keeping it as a pure function (instead of a baked texture) means the track
 * generator and the world builder can never drift out of sync.
 */

const W1 = 1 / 620;
const W2 = 1 / 340;
const W3 = 1 / 187;

export function terrainHeight(x: number, z: number): number {
  return (
    Math.sin(x * W1) * Math.cos(z * W1 * 1.21) * 7.5 +
    Math.sin((x + z) * W2) * 2.6 +
    Math.cos(x * W3 - z * W3 * 0.6) * 1.1
  );
}

/** Approximate surface normal of the height field, used for prop alignment. */
export function terrainSlope(x: number, z: number, out: { dx: number; dz: number }): void {
  const e = 4;
  out.dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  out.dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
}
