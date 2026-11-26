// Run with: node scripts/test-lib.mjs lib/grid-layouts.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  BLEND_MODES, BLEND_MODE_GROUPS, SIDE_COLORS, canvasBlendOp, complementColor, compositeSteps, compositeTint,
  compositeUsesEdges, edgeFilterPrimitives, effectiveSideColor, splitBlendCss, tintedCompositeOn,
} from "./grid-layouts.ts"

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

test("the four composites are valid blend modes, listed under Two dates", () => {
  const twoDates = BLEND_MODE_GROUPS.find((g) => g.label === "Two dates")!.items.map((i) => i.value)
  assert.deepEqual(twoDates, ["red-cyan", "red-cyan-dark", "ratio", "edges"])
  for (const mode of twoDates) assert.ok((BLEND_MODES as readonly string[]).includes(mode))
})

test("each composite's CSS mode, and its canvas name", () => {
  assert.equal(splitBlendCss("red-cyan"), "screen")
  assert.equal(splitBlendCss("ratio"), "color-burn")
  assert.equal(splitBlendCss("edges"), "difference")
  assert.equal(splitBlendCss("multiply"), "multiply")
  assert.equal(canvasBlendOp("normal"), "source-over")
  assert.equal(canvasBlendOp("plus-lighter"), "lighter")
  assert.equal(canvasBlendOp("color-burn"), "color-burn")
})

test("the two tints sum to white whatever A's color is", () => {
  for (const a of ["#0fbdbd", "#a855f7", "#f59e0b", "#123456"]) {
    const ta = channels(compositeTint("red-cyan", "A", a)!), tb = channels(compositeTint("red-cyan", "B", a)!)
    assert.deepEqual(ta.map((c, i) => c + tb[i]), [255, 255, 255])
  }
  // A grey A has no hue: neither view is tinted.
  assert.equal(compositeTint("red-cyan", "B", "#777777"), "#ffffff")
  assert.equal(compositeTint("ratio", "A", "#0fbdbd"), null)
})

test("B's effective color is the complement of A's only under a tinted composite", () => {
  assert.equal(complementColor("#0fbdbd"), "#bd0f0f")
  const overrides = { A: "#a855f7", B: "#22c55e" }
  assert.equal(effectiveSideColor("B", overrides, false), "#22c55e")
  assert.equal(effectiveSideColor("B", overrides, true), "#a4f755")
  assert.equal(effectiveSideColor("A", overrides, true), "#a855f7")
  assert.equal(effectiveSideColor("B", {}, true), complementColor(SIDE_COLORS.A))
  const on = { splitStyle: "overlay", splitBlendModeEnabled: true, splitBlendMode: "red-cyan-dark" }
  assert.equal(tintedCompositeOn(on), true)
  assert.equal(tintedCompositeOn({ ...on, splitBlendMode: "ratio" }), false)
  assert.equal(tintedCompositeOn({ ...on, splitBlendModeEnabled: false }), false)
  assert.equal(tintedCompositeOn({ ...on, splitStyle: "side-by-side" }), false)
})

test("the ratio's fills give 1 - A / (2 B) under color-burn", () => {
  const apply = (v: number, steps: { color: string; blend: string }[]) => steps.reduce((x, s) => {
    const c = channels(s.color)[0] / 255
    return s.blend === "multiply" ? x * c : s.blend === "difference" ? Math.abs(x - c) : x // saturation keeps a grey
  }, v)
  const burn = (backdrop: number, source: number) => 1 - Math.min(1, (1 - backdrop) / source)
  for (const [a, b] of [[0.4, 0.4], [0.3, 0.6], [0.6, 0.4]]) {
    const got = burn(apply(a, compositeSteps("ratio", "A", "#0fbdbd")!), apply(b, compositeSteps("ratio", "B", "#0fbdbd")!))
    assert.ok(Math.abs(got - (1 - a / (2 * b))) < 0.005, `${a}, ${b}: ${got}`)
  }
})

test("steps: none outside a composite, none for a third view, no fills for the edges", () => {
  assert.equal(compositeSteps("difference", "A", "#0fbdbd"), null)
  assert.equal(compositeSteps("red-cyan", "C", "#0fbdbd"), null)
  assert.deepEqual(compositeSteps("edges", "B", "#0fbdbd"), [])
  assert.equal(compositeUsesEdges("edges"), true)
  assert.equal(compositeSteps("red-cyan-dark", "A", "#0fbdbd")![0].blend, "difference")
})

test("the edge filter's radii follow the pixel ratio", () => {
  assert.match(edgeFilterPrimitives(1), /stdDeviation="1.2"/)
  assert.match(edgeFilterPrimitives(2), /stdDeviation="2.4"/)
  assert.match(edgeFilterPrimitives(2), /stdDeviation="6"/)
  assert.match(edgeFilterPrimitives(), /result="edges"\/>$/)
})
