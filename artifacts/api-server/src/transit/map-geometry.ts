export type Bounds = { west: number; south: number; east: number; north: number };
export const REGION: Bounds = { west: -74.27, south: 40.48, east: -71.85, north: 41.17 };

export function validBounds(b: Bounds) {
  return [b.west, b.south, b.east, b.north].every(Number.isFinite) && b.west >= -180 && b.east <= 180 &&
    b.west <= 180 && b.east >= -180 && b.south >= -90 && b.north <= 90 && b.west !== b.east && b.south < b.north;
}
export function splitBounds(b: Bounds): Bounds[] {
  return b.west <= b.east ? [b] : [{...b,east:180},{...b,west:-180}];
}
export function contains(b: Bounds, lon: number, lat: number) {
  return (b.west<=b.east?lon>=b.west&&lon<=b.east:lon>=b.west||lon<=b.east) && lat >= b.south && lat <= b.north;
}
/** Liang–Barsky: include lines crossing the viewport even if neither vertex is inside. */
export function intersects(coords: number[][], b: Bounds):boolean {
  if(b.west>b.east)return splitBounds(b).some(part=>intersects(coords,part));
  for (let i = 0; i < coords.length; i++) {
    if (contains(b, coords[i][0], coords[i][1])) return true;
    if (!i) continue;
    const [x, y] = coords[i - 1], dx = coords[i][0] - x, dy = coords[i][1] - y;
    let lo = 0, hi = 1, hit = true;
    const p = [-dx, dx, -dy, dy], q = [x - b.west, b.east - x, y - b.south, b.north - y];
    for (let j = 0; j < 4; j++) {
      if (p[j] === 0) { if (q[j] < 0) { hit = false; break; } }
      else {
        const t = q[j] / p[j];
        if (p[j] < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
        if (lo > hi) { hit = false; break; }
      }
    }
    if (hit) return true;
  }
  return false;
}
export function boundsOf(coords: number[][]): Bounds {
  const b = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const [x, y] of coords) {
    b.west = Math.min(b.west, x); b.east = Math.max(b.east, x);
    b.south = Math.min(b.south, y); b.north = Math.max(b.north, y);
  }
  return b;
}
export function overlaps(a: Bounds, b: Bounds):boolean {
  if(b.west>b.east)return splitBounds(b).some(part=>overlaps(a,part));
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}
/** Douglas–Peucker retains official vertices, never substitutes stop-to-stop paths. */
export function simplify(coords: number[][], tolerance: number) {
  if (coords.length < 3) return coords;
  const keep = new Set([0, coords.length - 1]), stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, z] = stack.pop()!, [x, y] = coords[a];
    const dx = coords[z][0] - x, dy = coords[z][1] - y, len = dx * dx + dy * dy;
    let max = tolerance * tolerance, index = -1;
    for (let i = a + 1; i < z; i++) {
      const t = len ? Math.max(0, Math.min(1, ((coords[i][0] - x) * dx + (coords[i][1] - y) * dy) / len)) : 0;
      const d = (coords[i][0] - x - t * dx) ** 2 + (coords[i][1] - y - t * dy) ** 2;
      if (d > max) { max = d; index = i; }
    }
    if (index !== -1) { keep.add(index); stack.push([a, index], [index, z]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => coords[i]);
}
