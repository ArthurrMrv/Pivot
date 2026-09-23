/** A square centred on (x, y) with half-size `s`, where two diagonally opposite
 *  corners are rounded by `k` and the other two stay square. This is the corner
 *  language the landing panels use, drawn small enough for a graph node. */
export const notch = (x: number, y: number, s: number, k: number) =>
  `M${x - s + k} ${y - s}H${x + s}V${y + s - k}A${k} ${k} 0 0 1 ${x + s - k} ${y + s}` +
  `H${x - s}V${y - s + k}A${k} ${k} 0 0 1 ${x - s + k} ${y - s}Z`
