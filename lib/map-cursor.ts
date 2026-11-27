// One owner for a map canvas's cursor.
//
// Two kinds of code want the cursor of a map canvas:
//
// - the drawing tools. Terra Draw's modes keep no record of the cursor: they
//   say it again on every pointer move (terra-draw 1.37: a drawing mode calls
//   setCursor(cursors.start), the crosshair, at the top of each onMouseMove;
//   the select mode calls setCursor("unset") on each move unless the pointer
//   is over the SELECTED feature or one of its handles, where it says "move"
//   or "crosshair"; every mode says "unset" in stop()). The library assumes
//   its adapter is the only thing that writes the cursor, and its own
//   adapters write straight to the element's style.
// - hovers: "this can be clicked" over a vector overlay's feature, a coverage
//   footprint, a tell candidate, a drawing that is not selected.
//
// Both wrote canvas.style.cursor, so the select mode's "unset" erased a
// hover's pointer on the next move, and each hover grew its own defence
// (write again every frame, write only when empty, clear only if still
// "pointer"). Here each side states what it wants and one function writes:
//
//   the tool's cursor, when it has one     (crosshair, move, grabbing)
//   else the hover claimed last            (pointer)
//   else nothing: the map's own grab hand, from MapLibre's stylesheet
//
// So "unset" from Terra Draw means "the tools have no cursor to show", which
// is all it ever meant, and a hover is stated once on entering a feature and
// withdrawn once on leaving it.

type CursorState = { tool: string | null; hovers: Map<string, string> }

const states = new WeakMap<HTMLElement, CursorState>()

function stateOf(canvas: HTMLElement): CursorState {
  let s = states.get(canvas)
  if (!s) { s = { tool: null, hovers: new Map() }; states.set(canvas, s) }
  return s
}

function apply(canvas: HTMLElement, s: CursorState): void {
  let cursor = s.tool ?? ""
  if (!cursor) for (const c of s.hovers.values()) cursor = c // the last claim
  if (cursor) { if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor }
  else if (canvas.style.cursor) canvas.style.removeProperty("cursor")
}

/** The drawing tools' cursor on this canvas; null (Terra Draw's "unset")
 *  when they have none. Called on every pointer move: writes only a change. */
export function setToolCursor(canvas: HTMLElement, cursor: string | null): void {
  const s = stateOf(canvas)
  s.tool = cursor && cursor !== "unset" ? cursor : null
  apply(canvas, s)
}

/** `owner` (one name per call site) shows `cursor` on this canvas until it
 *  releases it. Claiming again moves the claim to the front. */
export function claimHoverCursor(canvas: HTMLElement, owner: string, cursor = "pointer"): void {
  const s = stateOf(canvas)
  if (s.hovers.get(owner) === cursor && [...s.hovers.keys()].pop() === owner) return
  s.hovers.delete(owner)
  s.hovers.set(owner, cursor)
  apply(canvas, s)
}

/** Withdraws `owner`'s claim, if it has one. */
export function releaseHoverCursor(canvas: HTMLElement, owner: string): void {
  const s = states.get(canvas)
  if (!s || !s.hovers.delete(owner)) return
  apply(canvas, s)
}

/** `owner`'s claim follows `over`: the usual call from a mousemove handler. */
export function setHoverCursor(canvas: HTMLElement, owner: string, over: boolean, cursor = "pointer"): void {
  if (over) claimHoverCursor(canvas, owner, cursor)
  else releaseHoverCursor(canvas, owner)
}
