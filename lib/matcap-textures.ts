// Curated subset of Potree's bundled matcap ("material capture") images — CC0/
// public domain per their own license file (originally sourced from Blender's
// studio-light matcaps: potree/potree/resources/textures/matcap/
// blender_matcap_license.txt). Fetched directly from raw.githubusercontent.com
// at render time (confirmed to send `Access-Control-Allow-Origin: *`, so a
// WebGL texture upload from it isn't canvas-tainted) rather than vendored into
// this repo — these are reference/preview images, not app assets this project
// owns.
//
// Excludes potree's calibration-only images (check_normal+y, check_rim_*,
// reflection_check_*, contours_*) and the ambiguous "matcap.jpg" placeholder —
// kept to ones that actually look like a useful terrain-shading material.
export interface MatcapTexture {
  id: string
  name: string
  url: string
}

const BASE_URL = "https://raw.githubusercontent.com/potree/potree/develop/resources/textures/matcap/"

// A sphere whose surface colors ARE its own normal vector (R/G/B = x/y/z *
// 0.5 + 0.5) — the exact same encoding lib/normals-protocol.ts uses for real
// terrain tiles. Used as a matcap material this isn't "debug output" so much
// as a genuinely nice-looking iridescent/opal material — whatever color a
// point on this sphere is, that's what the same-angled patch of terrain
// looks like there.
// Pre-rendered once to public/matcap-normal-sphere.png (512x512, generated
// via the identical per-pixel math this comment used to hold inline) and
// fetched like every other entry below, rather than recomputed via canvas on
// every load — it's a fixed, unchanging image, no reason to pay the (small
// but non-zero) generation cost every session, and every other texture here
// is already just a fetched URL.
export const NORMAL_SPHERE_MATCAP_URL = "/matcap-normal-sphere.png"

export const MATCAP_TEXTURES: MatcapTexture[] = [
  { id: "normal_sphere", name: "Normal Sphere", url: NORMAL_SPHERE_MATCAP_URL },
  { id: "basic_1", name: "Basic 1", url: `${BASE_URL}basic_1.jpg` },
  { id: "basic_2", name: "Basic 2", url: `${BASE_URL}basic_2.jpg` },
  { id: "basic_dark", name: "Basic Dark", url: `${BASE_URL}basic_dark.jpg` },
  { id: "basic_side", name: "Basic Side-Lit", url: `${BASE_URL}basic_side.jpg` },
  { id: "ceramic_dark", name: "Ceramic Dark", url: `${BASE_URL}ceramic_dark.jpg` },
  { id: "ceramic_lightbulb", name: "Ceramic Lightbulb", url: `${BASE_URL}ceramic_lightbulb.jpg` },
  { id: "clay_brown", name: "Clay Brown", url: `${BASE_URL}clay_brown.jpg` },
  { id: "clay_muddy", name: "Clay Muddy", url: `${BASE_URL}clay_muddy.jpg` },
  { id: "clay_studio", name: "Clay Studio", url: `${BASE_URL}clay_studio.jpg` },
  { id: "jade", name: "Jade", url: `${BASE_URL}jade.jpg` },
  { id: "metal_anisotropic", name: "Metal Anisotropic", url: `${BASE_URL}metal_anisotropic.jpg` },
  { id: "metal_carpaint", name: "Metal Carpaint", url: `${BASE_URL}metal_carpaint.jpg` },
  { id: "metal_lead", name: "Metal Lead", url: `${BASE_URL}metal_lead.jpg` },
  { id: "metal_shiny", name: "Metal Shiny", url: `${BASE_URL}metal_shiny.jpg` },
  { id: "pearl", name: "Pearl", url: `${BASE_URL}pearl.jpg` },
  { id: "resin", name: "Resin", url: `${BASE_URL}resin.jpg` },
  { id: "skin", name: "Skin", url: `${BASE_URL}skin.jpg` },
  { id: "toon", name: "Toon", url: `${BASE_URL}toon.jpg` },
]

export const DEFAULT_MATCAP_ID = "clay_studio"
