// The graticule's line spacing at a zoom (GraticuleLayer.tsx); here so the
// tile service's direct engine (mcp/) draws the same grid.

// Auto density that halves with every zoom level, so the lines of each zoom
// are a subset of the next one's: the four children of a cell share all of
// their parent's outer edges, the way a quadtree does. geogrid's own table
// sets how many lines cross the view (about 4-8) but lands on 7.5 deg,
// 0.075 deg and the like, which do not nest; this keeps its coverage and
// picks the nearest 90 deg / 2^n instead (90, 45, 22.5, 11.25, 5.625 ...).
const GEOGRID_DENSITY: Record<number, number> = { 0: 30, 1: 15, 2: 10, 3: 7.5, 4: 5, 5: 3, 6: 2, 7: 1.5, 8: 0.75, 9: 0.5, 10: 0.25, 11: 0.125, 12: 0.075, 13: 0.05, 14: 0.025 }
export function niceGraticuleDensity(zoom: number): number {
    const z = Math.max(0, Math.floor(zoom))
    const raw = z <= 14 ? GEOGRID_DENSITY[z] : GEOGRID_DENSITY[14] / 2 ** (z - 14)
    const n = Math.max(0, Math.round(Math.log2(90 / raw)))
    return 90 / 2 ** n
}
