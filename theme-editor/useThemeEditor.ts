import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { TOKEN_GROUPS, SHADOW_BASE_KEYS, COLOR_TOKEN_KEYS } from "./token-schema"
import { deriveShadowTiers, shadowVarName, SHADOW_TIER_KEYS, type ShadowBase } from "./shadow-formula"
import { parseColorToOklch, formatOklch } from "./color-math"
import { randomizeColors, randomizeOthers } from "./randomize"

export function parseNum(value: string): number {
  const m = value.match(/-?[\d.]+/)
  return m ? parseFloat(m[0]) : 0
}

export type HslAdjust = { hue: number; saturation: number; lightness: number }
const IDENTITY_ADJUST: HslAdjust = { hue: 0, saturation: 1, lightness: 1 }

export type UseThemeEditorOptions = {
  /** Element whose CSS custom properties are read/written. Defaults to <html>. */
  target?: HTMLElement | null
  /** Attribute this app switches to change theme/preset. Defaults to "data-theme". */
  themeAttribute?: string
}

// The live-editing engine: reads the currently-cascaded value of every token
// once, then every edit writes an INLINE style override on `target` (always
// wins over the [data-theme="…"] stylesheet rule it's layered on top of) for
// instant preview with zero rebuild/recompile step. A MutationObserver on the
// theme attribute re-snapshots if some other control (e.g. a preset picker)
// changes the active preset while this is open, so edits always start from
// whatever preset is currently showing.
export function useThemeEditor(options: UseThemeEditorOptions = {}) {
  const target = options.target !== undefined ? options.target : (typeof document !== "undefined" ? document.documentElement : null)
  const themeAttribute = options.themeAttribute ?? "data-theme"

  const allKeys = useMemo(() => TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.key)), [])

  const readAll = useCallback((): Record<string, string> => {
    if (!target || typeof getComputedStyle === "undefined") return {}
    const style = getComputedStyle(target)
    const out: Record<string, string> = {}
    for (const key of allKeys) out[key] = style.getPropertyValue(`--${key}`).trim()
    return out
  }, [target, allKeys])

  const [values, setValues] = useState<Record<string, string>>(() => readAll())
  const [themeName, setThemeName] = useState<string>(() => target?.getAttribute(themeAttribute) ?? "custom")
  const [adjust, setAdjustState] = useState<HslAdjust>(IDENTITY_ADJUST)

  // The palette the HSL sliders shift FROM — distinct from `values` (which
  // changes on every keystroke/drag) so moving a slider always recomputes
  // from one stable starting point instead of compounding on itself. Reset
  // whenever the underlying preset changes (externally or via reset()) or a
  // fresh palette is generated via randomize(), so sliders always adjust
  // "the current deliberate palette", not always back to the original preset.
  const baselineRef = useRef<Record<string, string>>(values)

  useEffect(() => {
    if (!target || typeof MutationObserver === "undefined") return
    const observer = new MutationObserver(() => {
      setThemeName(target.getAttribute(themeAttribute) ?? "custom")
      const snapshot = readAll()
      setValues(snapshot)
      baselineRef.current = snapshot
      setAdjustState(IDENTITY_ADJUST)
    })
    observer.observe(target, { attributes: true, attributeFilter: [themeAttribute] })
    return () => observer.disconnect()
  }, [target, themeAttribute, readAll])

  const applyDerivedShadows = useCallback((next: Record<string, string>) => {
    if (!target) return
    const base: ShadowBase = {
      color: next["shadow-color"] || "oklch(0 0 0)",
      opacity: parseNum(next["shadow-opacity"] ?? "0.1"),
      blur: parseNum(next["shadow-blur"] ?? "0"),
      spread: parseNum(next["shadow-spread"] ?? "0"),
      offsetX: parseNum(next["shadow-offset-x"] ?? "0"),
      offsetY: parseNum(next["shadow-offset-y"] ?? "0"),
    }
    for (const [varName, val] of Object.entries(deriveShadowTiers(base))) {
      target.style.setProperty(varName, val)
    }
  }, [target])

  const setValue = useCallback((key: string, value: string) => {
    target?.style.setProperty(`--${key}`, value)
    setValues((prev) => {
      const next = { ...prev, [key]: value }
      if ((SHADOW_BASE_KEYS as readonly string[]).includes(key)) applyDerivedShadows(next)
      return next
    })
  }, [target, applyDerivedShadows])

  // Applies each color token's baseline OKLCH shifted by (hue°, ×saturation,
  // ×lightness) — a global "Adjust" pass, same idea as tweakcn's own Hue/
  // Saturation/Lightness sliders. Deliberately overwrites any hand-edited
  // color token back to the baseline-plus-shift: this is a "retint the whole
  // palette at once" tool, not a per-token nudge, so it wins over individual
  // edits the same way an adjustment layer would.
  const applyValues = useCallback((patch: Record<string, string>) => {
    if (!target) return
    for (const [key, value] of Object.entries(patch)) target.style.setProperty(`--${key}`, value)
    setValues((prev) => {
      const next = { ...prev, ...patch }
      if (Object.keys(patch).some((k) => (SHADOW_BASE_KEYS as readonly string[]).includes(k))) applyDerivedShadows(next)
      return next
    })
  }, [target, applyDerivedShadows])

  const setAdjust = useCallback((next: HslAdjust) => {
    setAdjustState(next)
    const patch: Record<string, string> = {}
    for (const key of COLOR_TOKEN_KEYS) {
      const base = baselineRef.current[key]
      if (!base) continue
      const oklch = parseColorToOklch(base)
      patch[key] = formatOklch({
        l: Math.min(1, Math.max(0, oklch.l * next.lightness)),
        c: Math.max(0, oklch.c * next.saturation),
        h: ((oklch.h + next.hue) % 360 + 360) % 360,
        alpha: oklch.alpha,
      })
    }
    applyValues(patch)
  }, [applyValues])

  const resetAdjust = useCallback(() => setAdjust(IDENTITY_ADJUST), [setAdjust])

  // Generates a fresh semantically-aware random palette (see randomize.ts)
  // plus random-but-tasteful radius/spacing/letter-spacing/shadow/font
  // values, applies all of it live, and becomes the new HSL-adjust baseline.
  const randomize = useCallback(() => {
    if (!target) return
    const isDark = parseColorToOklch(values.background || "oklch(0.98 0 0)").l < 0.5
    const patch = { ...randomizeColors(isDark), ...randomizeOthers() }
    applyValues(patch)
    baselineRef.current = { ...baselineRef.current, ...patch }
    setAdjustState(IDENTITY_ADJUST)
  }, [target, values.background, applyValues])

  const reset = useCallback(() => {
    if (!target) return
    for (const key of allKeys) target.style.removeProperty(`--${key}`)
    for (const tier of SHADOW_TIER_KEYS) target.style.removeProperty(shadowVarName(tier))
    const snapshot = readAll()
    setValues(snapshot)
    baselineRef.current = snapshot
    setAdjustState(IDENTITY_ADJUST)
  }, [target, allKeys, readAll])

  const buildCss = useCallback((name: string): string => {
    const derived = deriveShadowTiers({
      color: values["shadow-color"] || "oklch(0 0 0)",
      opacity: parseNum(values["shadow-opacity"] ?? "0.1"),
      blur: parseNum(values["shadow-blur"] ?? "0"),
      spread: parseNum(values["shadow-spread"] ?? "0"),
      offsetX: parseNum(values["shadow-offset-x"] ?? "0"),
      offsetY: parseNum(values["shadow-offset-y"] ?? "0"),
    })
    const lines = [
      ...allKeys.map((key) => `  --${key}: ${values[key] ?? ""};`),
      ...Object.entries(derived).map(([varName, val]) => `  ${varName}: ${val};`),
    ]
    return `[data-theme="${name}"] {\n${lines.join("\n")}\n}`
  }, [values, allKeys])

  // Never throws — the Clipboard API can legitimately reject (no permission,
  // an unfocused document, an insecure/automated context), and a broken copy
  // button shouldn't take the whole panel down with it. Falls back to the
  // legacy execCommand path, which works in a few of those same cases.
  const copyCss = useCallback(async (name: string = themeName): Promise<{ css: string; copied: boolean }> => {
    const css = buildCss(name)
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(css)
        return { css, copied: true }
      } catch { /* fall through to legacy path below */ }
    }
    if (typeof document !== "undefined") {
      try {
        const textarea = document.createElement("textarea")
        textarea.value = css
        textarea.style.position = "fixed"
        textarea.style.opacity = "0"
        document.body.appendChild(textarea)
        textarea.select()
        const ok = document.execCommand("copy")
        document.body.removeChild(textarea)
        return { css, copied: ok }
      } catch { /* give up silently, css is still returned */ }
    }
    return { css, copied: false }
  }, [buildCss, themeName])

  return { values, setValue, themeName, setThemeName, reset, copyCss, buildCss, adjust, setAdjust, resetAdjust, randomize }
}
