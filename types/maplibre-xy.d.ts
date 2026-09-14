// maplibre-xy ships untyped JS. Only the Underzoom export is used here (see the
// transformConstrain wiring in TerrainViewer.tsx); `transformConstrain` is handed
// straight to maplibre's transform.setConstrainOverride(), which takes maplibre's
// own internal constrain signature, so it is intentionally left loose.
declare module "maplibre-xy" {
  export interface UnderzoomOptions {
    /** How far you can zoom out past the bounds, as a ratio of viewport size. Default 0.9. */
    extendScale?: number
    /** How far you can pan past the bounds, as a ratio of edge-to-centre distance. Default 0.2. */
    extendPan?: number
    /** Master on/off for the custom constraint. Default true. */
    extend?: boolean
  }
  export class Underzoom {
    constructor(maplibregl: unknown, options?: UnderzoomOptions)
    extendScale: number
    extendPan: number
    extend: boolean
    transformConstrain: (...args: any[]) => any
  }
}
