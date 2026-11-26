// What the River REM mode shares between its engine (in view A's map, see
// components/RiverRem/RiverRemLayers.tsx) and its sidebar panels. Nothing
// here is shareable state: every setting of the mode is in the URL (the
// `rem*` fields of QUERY_STATE_PARSERS). These are results and local UI.

import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import type { LngLat } from "./river-rem"

export type RiverRemPhase = "idle" | "rivers" | "sampling" | "trend" | "ready" | "empty" | "error"

export interface RiverRemStatus {
  phase: RiverRemPhase
  /** One plain sentence for the panel. */
  message: string
  /** Set when asking again can help (Overpass busy or unreachable). */
  canRetry?: boolean
}

export const riverRemStatusAtom = atom<RiverRemStatus>({ phase: "idle", message: "" })

/** The rivers OpenStreetMap has in the searched box, longest first. */
export const riverRemRiversAtom = atom<{ name: string; kind: string; lengthM: number }[]>([])

/** Revision of the trend surface in lib/river-rem-protocol.ts: part of the
 *  tile URL, so a new one reloads the tiles. 0 = none yet. */
export const riverRemRevisionAtom = atom(0)

/** The centerline in use, for drawing it on every view. */
export const riverRemLinesAtom = atom<LngLat[][]>([])

/** What the last computation used, for the panel's read-outs. */
export interface RiverRemInfo {
  riverLabel: string
  lengthM: number
  points: number
  spacingM: number
  sampleZoom: number
  neighbors: number
  sinuosity: number
  /** Water level at the upstream and downstream ends, after cleaning. */
  levelHigh: number
  levelLow: number
  /** Samples the cleaning moved by more than 10 cm. */
  corrected: number
  /** Time spent filling the trend grid, in ms, its size and the method. */
  buildMs: number
  gridW: number
  gridH: number
  method: "idw" | "nearest"
}
export const riverRemInfoAtom = atom<RiverRemInfo | null>(null)

/** Bumped by the panel's Retry button; the engine asks Overpass again. */
export const riverRemRetryAtom = atom(0)

/** The drawn line the panel follows (a Terra Draw feature id): while it is
 *  set, edits to that feature are copied to `remLine` in the URL. Local: a
 *  link carries the line itself, not the drawing. */
export const riverRemDrawnIdAtom = atom<string | null>(null)

/** Fold state of the mode's own sidebar sections and of its group row. */
export const riverRemSectionsOpenAtom = atomWithStorage("riverRemSectionsOpen", { group: true, river: true, detrending: false, display: true })

/** The long work in progress, for the bottom toast: which of the four steps
 *  (1 centerline, 2 sampling, 3 detrending, 4 rendering), one line of
 *  detail, and how far the step is when that is known (0..1; undefined
 *  spins). Null when nothing is running. */
export interface RiverRemProgress { step: 1 | 2 | 3 | 4; detail: string; fraction?: number }
export const riverRemProgressAtom = atom<RiverRemProgress | null>(null)

/** Elevation display: lowest and highest height of the tiles in view A,
 *  followed while `remElevAuto` is on. */
export const riverRemElevRangeAtom = atom<{ min: number; max: number } | null>(null)
