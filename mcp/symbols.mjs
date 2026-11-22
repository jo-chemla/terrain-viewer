// Where MapLibre puts symbols along lines (symbol-placement line), ported
// from maplibre-gl-js: src/symbol/clip_line.ts, get_anchors.ts and
// check_max_angle.ts. Each vector tile places its own: a line is clipped to
// the tile, a clipped line (continued from the next tile) starts half a
// spacing in, any other line by the label's half length plus two em, and a
// text label is dropped where the line turns more than text-max-angle
// within 3/5 em. Geometry in tile units (8192 to the tile, as MapLibre
// reads it).

export const EXTENT = 8192

/** Lines clipped to the box, as MapLibre clips them before placing. */
export function clipLines(lines, x1, y1, x2, y2) {
  const out = []
  const at = (x, y) => [Math.round(x), Math.round(y)]
  for (const line of lines) {
    let cur
    for (let i = 0; i < line.length - 1; i++) {
      let p0 = line[i], p1 = line[i + 1]
      if (p0[0] < x1 && p1[0] < x1) continue
      else if (p0[0] < x1) p0 = at(x1, p0[1] + (p1[1] - p0[1]) * ((x1 - p0[0]) / (p1[0] - p0[0])))
      else if (p1[0] < x1) p1 = at(x1, p0[1] + (p1[1] - p0[1]) * ((x1 - p0[0]) / (p1[0] - p0[0])))
      if (p0[1] < y1 && p1[1] < y1) continue
      else if (p0[1] < y1) p0 = at(p0[0] + (p1[0] - p0[0]) * ((y1 - p0[1]) / (p1[1] - p0[1])), y1)
      else if (p1[1] < y1) p1 = at(p0[0] + (p1[0] - p0[0]) * ((y1 - p0[1]) / (p1[1] - p0[1])), y1)
      if (p0[0] >= x2 && p1[0] >= x2) continue
      else if (p0[0] >= x2) p0 = at(x2, p0[1] + (p1[1] - p0[1]) * ((x2 - p0[0]) / (p1[0] - p0[0])))
      else if (p1[0] >= x2) p1 = at(x2, p0[1] + (p1[1] - p0[1]) * ((x2 - p0[0]) / (p1[0] - p0[0])))
      if (p0[1] >= y2 && p1[1] >= y2) continue
      else if (p0[1] >= y2) p0 = at(p0[0] + (p1[0] - p0[0]) * ((y2 - p0[1]) / (p1[1] - p0[1])), y2)
      else if (p1[1] >= y2) p1 = at(p0[0] + (p1[0] - p0[0]) * ((y2 - p0[1]) / (p1[1] - p0[1])), y2)
      if (!cur || cur[cur.length - 1][0] !== p0[0] || cur[cur.length - 1][1] !== p0[1]) { cur = [p0]; out.push(cur) }
      cur.push(p1)
    }
  }
  return out
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
const angleTo = (a, b) => Math.atan2(a[1] - b[1], a[0] - b[0])

/** Whether a label of `labelLength` centred on the anchor turns less than
 *  `maxAngle` within any stretch of `windowSize` (check_max_angle.ts). */
function checkMaxAngle(line, anchor, labelLength, windowSize, maxAngle) {
  let p = [anchor.x, anchor.y], index = anchor.segment + 1, anchorDistance = 0
  while (anchorDistance > -labelLength / 2) {
    index--
    if (index < 0) return false
    anchorDistance -= dist(line[index], p)
    p = line[index]
  }
  anchorDistance += dist(line[index], line[index + 1])
  index++
  const recent = []
  let recentAngleDelta = 0
  while (anchorDistance < labelLength / 2) {
    const prev = line[index - 1], current = line[index], next = line[index + 1]
    if (!next) return false
    let delta = angleTo(prev, current) - angleTo(current, next)
    delta = Math.abs(((delta + 3 * Math.PI) % (Math.PI * 2)) - Math.PI)
    recent.push({ distance: anchorDistance, delta })
    recentAngleDelta += delta
    while (anchorDistance - recent[0].distance > windowSize) recentAngleDelta -= recent.shift().delta
    if (recentAngleDelta > maxAngle) return false
    index++
    anchorDistance += dist(current, next)
  }
  return true
}

/**
 * The anchors of one feature's symbols in one tile: `{ x, y, angle,
 * segment, line }` in tile units, angle along the line, `line` the clipped
 * line it sits on. `lines`: the feature's geometry in tile units.
 * opts: spacingPx (symbol-spacing), shapedLength (the label's length: an
 * icon's width in px, or a text's in 24 px glyph units), boxSize (the
 * text-size, 16 by default, which scales the box of icons too), text
 * (whether the turn check applies), maxAngle (radians, text-max-angle),
 * overscaling (2^(zoom - maxzoom) past the source's last zoom).
 */
export function symbolAnchors(lines, { spacingPx, shapedLength, boxSize = 16, text = false, maxAngle = Math.PI / 4, overscaling = 1 }) {
  const tilePixelRatio = EXTENT / (512 * overscaling)
  const boxScale = (tilePixelRatio * boxSize) / 24
  const labelLength = shapedLength * boxScale
  const windowSize = text ? (3 / 5) * 24 * boxScale : 0
  const out = []
  for (const line of clipLines(lines, 0, 0, EXTENT, EXTENT)) {
    let spacing = tilePixelRatio * spacingPx
    const continued = line[0][0] === 0 || line[0][0] === EXTENT || line[0][1] === 0 || line[0][1] === EXTENT
    if (spacing - labelLength < spacing / 4) spacing = labelLength + spacing / 4
    const offset = continued ? ((spacing / 2) * overscaling) % spacing : ((shapedLength / 2 + 48) * boxScale * overscaling) % spacing
    let total = 0
    for (let i = 0; i < line.length - 1; i++) total += dist(line[i], line[i + 1])
    const resample = (start, middle) => {
      const found = []
      let distance = 0, marked = start - spacing
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1], seg = dist(a, b)
        while (marked + spacing < distance + seg) {
          marked += spacing
          const t = (marked - distance) / seg, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t
          if (x >= 0 && x < EXTENT && y >= 0 && y < EXTENT && marked - labelLength / 2 >= 0 && marked + labelLength / 2 <= total) {
            const anchor = { x: Math.round(x), y: Math.round(y), angle: Math.atan2(b[1] - a[1], b[0] - a[0]), segment: i, line }
            if (!windowSize || checkMaxAngle(line, anchor, labelLength, windowSize, maxAngle)) found.push(anchor)
          }
        }
        distance += seg
      }
      if (!middle && !found.length && !continued) return resample(distance / 2, true)
      return found
    }
    out.push(...resample(offset, false))
  }
  return out
}
