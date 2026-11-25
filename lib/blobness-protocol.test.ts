// node scripts/test-lib.mjs lib/blobness-protocol.test.ts
// The structure tensor's orientation is a compass axis, 0-180°, of the
// dominant gradient: not mirrored east-west the way Aspect was until
// 2026-11-25 (lib/aspect-protocol.test.ts). The QGIS plugin's Python port
// (qgis-plugin/terrain_viewer/live/kernels.py orientation) is checked
// against the same cases in qgis-plugin/test_live.py.
import { test } from "node:test"
import assert from "node:assert/strict"
import { computeStructureTensor, eigenRatioFromTensor, orientationFromTensor } from "./blobness-protocol"

// A 5x5 window (the tensor's halo is 2), rows top (north) to bottom (south),
// of z(east, north): the sample closure computeStructureTensor reads.
function windowOf(z: (east: number, north: number) => number) {
  return (dr: number, dc: number) => z(dc, -dr)
}
const orientation = (z: (e: number, n: number) => number) => {
  const { Ixx, Iyy, Ixy } = computeStructureTensor(windowOf(z), 1)
  return orientationFromTensor(Ixx, Iyy, Ixy)
}
const near = (a: number, b: number) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b)) < 1e-9

test("a plane rising to the north-east reads 45° (south-west 45° too: an axis)", () => {
  assert.ok(near(orientation((e, n) => e + n), 45))
  assert.ok(near(orientation((e, n) => -e - n), 45))
})
test("a plane rising to the north-west reads 135°, not 45° (no mirror)", () => {
  assert.ok(near(orientation((e, n) => -e + n), 135))
  assert.ok(near(orientation((e, n) => e - n), 135))
})
test("east-west slopes read 90°, north-south slopes 0°", () => {
  assert.ok(near(orientation((e) => 3 * e), 90))
  assert.ok(near(orientation((_e, n) => 2 * n), 0))
})
test("a ridge running north-south reads 90°: the axis across it", () => {
  assert.ok(near(orientation((e) => -Math.abs(e) * 10), 90))
  assert.ok(near(orientation((_e, n) => -Math.abs(n) * 10), 0))
})
test("the eigenvalue ratio: 0 on a plane, 100 on a cone", () => {
  const plane = computeStructureTensor(windowOf((e, n) => e + 2 * n), 1)
  assert.ok(eigenRatioFromTensor(plane.Ixx, plane.Iyy, plane.Ixy) < 1e-9)
  const cone = computeStructureTensor(windowOf((e, n) => -Math.hypot(e, n)), 1)
  assert.ok(eigenRatioFromTensor(cone.Ixx, cone.Iyy, cone.Ixy) > 99.9)
})
