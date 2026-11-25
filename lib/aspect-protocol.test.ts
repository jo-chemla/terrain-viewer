// node scripts/test-lib.mjs lib/aspect-protocol.test.ts
// Aspect is the direction a slope faces (downhill), as gdaldem reports it.
import { test } from "node:test"
import assert from "node:assert/strict"
import { aspectCompassDeg } from "./aspect-protocol"

// The Horn gradient of aspect-protocol.ts on a 3x3 window, rows top (north) to
// bottom (south): dx = west column - east column, dy = south row - north row.
function horn(w: number[][]) {
  const [[a0, a1, a2], [a3, , a5], [a6, a7, a8]] = w
  return { dx: a0 + 2 * a3 + a6 - (a2 + 2 * a5 + a8), dy: a6 + 2 * a7 + a8 - (a0 + 2 * a1 + a2) }
}
const facing = (w: number[][]) => { const { dx, dy } = horn(w); return aspectCompassDeg(dx, dy) }

test("an east-facing slope (higher in the west) reads 90°", () => {
  assert.equal(facing([[2, 1, 0], [2, 1, 0], [2, 1, 0]]), 90)
})
test("west 270°, north 0°, south 180°", () => {
  assert.equal(facing([[0, 1, 2], [0, 1, 2], [0, 1, 2]]), 270)
  assert.equal(facing([[0, 0, 0], [1, 1, 1], [2, 2, 2]]), 0)
  assert.equal(facing([[2, 2, 2], [1, 1, 1], [0, 0, 0]]), 180)
})
test("north-east facing reads 45°, flat reads 0°", () => {
  assert.ok(Math.abs(facing([[1, 0, -1], [2, 1, 0], [3, 2, 1]]) - 45) < 1e-9)
  assert.equal(facing([[1, 1, 1], [1, 1, 1], [1, 1, 1]]), 0)
})
