// node scripts/test-lib.mjs lib/map-cursor.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { setToolCursor, claimHoverCursor, releaseHoverCursor, setHoverCursor } from "./map-cursor"

/** A canvas as far as the cursor goes, counting the writes. */
function fakeCanvas() {
  let cursor = ""
  let writes = 0
  const style = {
    get cursor() { return cursor },
    set cursor(v: string) { cursor = v; writes++ },
    removeProperty(name: string) { if (name === "cursor") { cursor = ""; writes++ } },
  }
  return { el: { style } as unknown as HTMLElement, cursor: () => cursor, writes: () => writes }
}

test("a hover holds through the select mode's unset on every move, and clears on leave", () => {
  const c = fakeCanvas()
  setToolCursor(c.el, "unset")
  setHoverCursor(c.el, "vector", true)
  assert.equal(c.cursor(), "pointer")
  const before = c.writes()
  for (let i = 0; i < 50; i++) { setToolCursor(c.el, "unset"); setHoverCursor(c.el, "vector", true) }
  assert.equal(c.cursor(), "pointer")
  assert.equal(c.writes(), before, "nothing is written while nothing changes")
  setHoverCursor(c.el, "vector", false)
  assert.equal(c.cursor(), "")
})

test("a drawing mode's crosshair wins over a hover, and the hover is back when the tool lets go", () => {
  const c = fakeCanvas()
  claimHoverCursor(c.el, "vector")
  setToolCursor(c.el, "crosshair")
  assert.equal(c.cursor(), "crosshair")
  setToolCursor(c.el, "pointer") // the closing point
  assert.equal(c.cursor(), "pointer")
  setToolCursor(c.el, "unset") // stop()
  assert.equal(c.cursor(), "pointer", "the hover's")
  releaseHoverCursor(c.el, "vector")
  assert.equal(c.cursor(), "")
})

test("the move cursor over a selected drawing wins over a feature under it", () => {
  const c = fakeCanvas()
  claimHoverCursor(c.el, "vector")
  setToolCursor(c.el, "move")
  assert.equal(c.cursor(), "move")
  setToolCursor(c.el, null)
  assert.equal(c.cursor(), "pointer")
})

test("several hovers: the last claim shows, a release leaves the others", () => {
  const c = fakeCanvas()
  claimHoverCursor(c.el, "coverage")
  claimHoverCursor(c.el, "vector", "help")
  assert.equal(c.cursor(), "help")
  releaseHoverCursor(c.el, "vector")
  assert.equal(c.cursor(), "pointer")
  releaseHoverCursor(c.el, "nobody")
  assert.equal(c.cursor(), "pointer")
  releaseHoverCursor(c.el, "coverage")
  assert.equal(c.cursor(), "")
})

test("canvases are apart", () => {
  const a = fakeCanvas(), b = fakeCanvas()
  claimHoverCursor(a.el, "vector")
  setToolCursor(b.el, "crosshair")
  assert.equal(a.cursor(), "pointer")
  assert.equal(b.cursor(), "crosshair")
})
