---
name: no-op-ease-pins-centre-on-resize
description: Never start a MapLibre ease that changes nothing; on load it pins the centre to the default 400x300 canvas and the view lands half the size difference away
type: project
---

A MapLibre ease (`easeTo`, any duration) puts the centre back, on every
frame, at the screen point it had when the ease started. If the canvas is
resized while the ease runs, the map ends offset by half the size change.

On load every `<Map>` is first built in MapLibre's default 400 x 300 canvas
(the container is measured a moment later, through the ResizeObserver), and
effects that run at mount fire before that resize. Two of them started an
ease that changed nothing: the padding effect (`easeTo({ padding })`, all
zero when the side panel starts closed) and the 2D effect
(`easeTo({ bearing: 0, pitch: 0 })`). Result, found 2026-11-19: with
`sidebarCollapsed=true` the default view, and any 2D project (Dura), opened
about 430 px east and 200 px south of the link's centre, and in the 2D
case the wrong centre was written back to the link.

**Why:** reported by Jonathan as "very weird centre when the side panel is
closed on loading"; traced by wrapping `Map.prototype` methods and the
transform (`TR.apply` from `_onEaseFrame` right after `resize`).

**How to apply:** before any `easeTo` in an effect that can run at mount,
check that there is something to ease (`isPaddingEqual`, bearing and pitch
already 0) and skip it otherwise. A real ease at mount would have the same
fault: prefer `transform` setters or `jumpTo` until the map has loaded.
See [[camera-sync]].
