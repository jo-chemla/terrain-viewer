import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { TOKEN_GROUPS, SHADOW_BASE_KEYS, COLOR_TOKEN_KEYS } from "./token-schema"
import { deriveShadowTiers, shadowVarName, SHADOW_TIER_KEYS, type ShadowBase } from "./shadow-formula"
import { parseColorToOklch, formatOklch } from "./color-math"
import { randomizeColors, randomizeOthers } from "./randomize"
import {
  DEFAULT_BASIC_OPTIONS, buildBasicPalette, buildStyleValues, findStyle, type BasicOptions,
  STYLE_PRESETS, BASE_COLOR_FAMILIES, NAMED_HUES, MENU_ACCENT_LEVELS,
} from "./basic-presets"

export function parseNum(value: string): number {
  const m = value.match(/-?[\d.]+/)
  return m ? parseFloat(m[0]) : 0
}

// Generic/system font families that are always available — never worth trying
// to fetch from Google Fonts.
const GENERIC_FONTS = new Set([
  "inherit", "initial", "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded",
  "-apple-system", "blinkmacsystemfont", "emoji", "math", "fangsong",
])

// Live-loads a font family the user selected/typed if it isn't a generic family
// and hasn't already been requested — so choosing (or typing) any Google Font in
// the Typography section actually renders instead of silently falling back to
// the next family in the stack. Best-effort: a missing/unavailable family just
// won't load, same as before.
function ensureFontLoaded(fontStack: string) {
  if (typeof document === "undefined" || !fontStack) return
  const first = fontStack.split(",")[0].trim().replace(/^['"]|['"]$/g, "").trim()
  if (!first || GENERIC_FONTS.has(first.toLowerCase())) return
  const id = "tec-font-" + first.replace(/\s+/g, "-").toLowerCase()
  if (document.getElementById(id)) return
  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  link.href = `https://fonts.googleapis.com/css2?family=${first.replace(/\s+/g, "+")}:wght@400;500;600;700&display=swap`
  document.head.appendChild(link)
}

// themeName must be the BARE color-preset name — buildCss()'s save flow
// appends its own "-light"/"-dark" suffix, so a themeName that already had
// one (reading the raw data-theme attribute verbatim, e.g. "cyberpunk-light")
// used to produce double-suffixed, unmatchable selectors like
// "cyberpunk-light-light" on save.
function bareThemeName(attr: string | null): string {
  return (attr ?? "custom").replace(/-(light|dark)$/, "")
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
  const [themeName, setThemeName] = useState<string>(() => bareThemeName(target?.getAttribute(themeAttribute) ?? null))
  const [adjust, setAdjustState] = useState<HslAdjust>(IDENTITY_ADJUST)

  // The palette the HSL sliders shift FROM — distinct from `values` (which
  // changes on every keystroke/drag) so moving a slider always recomputes
  // from one stable starting point instead of compounding on itself. Reset
  // whenever the underlying preset changes (externally or via reset()) or a
  // fresh palette is generated via randomize(), so sliders always adjust
  // "the current deliberate palette", not always back to the original preset.
  const baselineRef = useRef<Record<string, string>>(values)

  // Read inside the observer callback below via a ref (not the `themeName`
  // state directly) — the effect that creates the observer only re-runs when
  // target/themeAttribute/readAll/allKeys change, so a closure over the state
  // value itself would go stale the moment themeName updates without the
  // observer being recreated.
  const themeNameRef = useRef(themeName)
  themeNameRef.current = themeName

  useEffect(() => {
    if (!target || typeof MutationObserver === "undefined") return
    const observer = new MutationObserver(() => {
      const nextBareName = bareThemeName(target.getAttribute(themeAttribute))
      // Only clear inline overrides when the PRESET NAME itself actually
      // changed (a plain preset dropdown, or this panel's own "Load Preset"
      // picker) — that means "start fresh from this preset," so any inline
      // --token overrides left over from edits made to the PREVIOUS preset
      // must go first, or they'd keep outranking the new preset's
      // [data-theme="…"] stylesheet rule for whichever tokens were touched.
      // A SAME-name attribute change is just a light/dark flip — notably the
      // one this panel's OWN Randomize/Shuffle triggers via onModeChange
      // after already applying a fresh palette — and must NOT clear anything,
      // or every self-triggered mode flip would immediately wipe the colors
      // Randomize/Shuffle just set, snapping back to the old preset's stale
      // stylesheet values a moment later.
      if (nextBareName !== themeNameRef.current) {
        for (const key of allKeys) target.style.removeProperty(`--${key}`)
        for (const tier of SHADOW_TIER_KEYS) target.style.removeProperty(shadowVarName(tier))
      }
      setThemeName(nextBareName)
      const snapshot = readAll()
      setValues(snapshot)
      baselineRef.current = snapshot
      setAdjustState(IDENTITY_ADJUST)
    })
    observer.observe(target, { attributes: true, attributeFilter: [themeAttribute] })
    return () => observer.disconnect()
  }, [target, themeAttribute, readAll, allKeys])

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
    if (key.startsWith("font-")) ensureFontLoaded(value)
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
    for (const [key, value] of Object.entries(patch)) {
      target.style.setProperty(`--${key}`, value)
      if (key.startsWith("font-")) ensureFontLoaded(value)
    }
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
  // Also coin-flips light vs dark (rather than keeping whatever mode is
  // currently active) — returns the chosen isDark so the caller can sync the
  // HOST APP's own light/dark toggle to match (this package doesn't know
  // about that toggle itself, see ThemeEditorPanelProps.onModeChange).
  const randomize = useCallback((): boolean => {
    if (!target) return false
    const isDark = Math.random() < 0.5
    const patch = { ...randomizeColors(isDark), ...randomizeOthers() }
    applyValues(patch)
    baselineRef.current = { ...baselineRef.current, ...patch }
    setAdjustState(IDENTITY_ADJUST)
    return isDark
  }, [target, applyValues])

  const [basicOptions, setBasicOptionsState] = useState<BasicOptions>(DEFAULT_BASIC_OPTIONS)
  const basicOptionsRef = useRef(basicOptions)
  basicOptionsRef.current = basicOptions

  // Which Basic-mode fields shuffleBasic() should leave untouched — same idea
  // as ui.shadcn.com/create's per-property lock icons next to its own Shuffle
  // action. All unlocked by default.
  const [locks, setLocks] = useState<Record<keyof BasicOptions, boolean>>({
    style: false, baseColor: false, theme: false, chartColor: false, radius: false, menuSolid: false, menuAccent: false,
  })
  const toggleLock = useCallback((key: keyof BasicOptions) => {
    setLocks((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  // Derives the full palette + style-bundled font/radius/shadow values from
  // the small Basic-mode control set (see basic-presets.ts) and applies it
  // live, same as randomize() — becomes the new HSL-adjust baseline too, so
  // Adjust sliders shift the derived palette rather than whatever preset was
  // active before Basic mode was touched. Side effects run here, in the
  // callback body — NOT inside the setBasicOptionsState updater, which
  // should stay a pure function of its previous state. `forcedIsDark` lets
  // shuffleBasic() below pin an explicit coin-flipped mode instead of the
  // default heuristic (infer from the CURRENT background) — a single field
  // edit (e.g. changing just "Theme") should never flip mode on its own, but
  // a full shuffle needs to decide it fresh rather than inherit whatever the
  // panel happened to be showing before.
  const setBasicOption = useCallback((patch: Partial<BasicOptions>, forcedIsDark?: boolean) => {
    const next = { ...basicOptionsRef.current, ...patch }
    setBasicOptionsState(next)
    if (!target) return
    const isDark = forcedIsDark ?? parseColorToOklch(values.background || "oklch(0.98 0 0)").l < 0.5
    const fullPatch = { ...buildBasicPalette(next, isDark), ...buildStyleValues(findStyle(next.style)), radius: `${next.radius}rem` }
    applyValues(fullPatch)
    baselineRef.current = { ...baselineRef.current, ...fullPatch }
    setAdjustState(IDENTITY_ADJUST)
  }, [target, values.background, applyValues])

  // Randomizes only the UNLOCKED Basic-mode fields, leaving locked ones at
  // their current value — reuses setBasicOption for the actual derivation/
  // apply step, same as any other Basic-mode edit. Also coin-flips light vs
  // dark itself (same idea as the old raw randomize() below) and returns the
  // isDark it picked, so the panel's single remaining shuffle button can keep
  // the host app's own light/dark toggle in sync — this is now the ONLY
  // randomize action the panel exposes, so it needs to own that responsibility
  // rather than leaving mode permanently wherever it last was.
  const shuffleBasic = useCallback((): boolean => {
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
    const isDark = Math.random() < 0.5
    const patch: Partial<BasicOptions> = {}
    if (!locks.style) patch.style = pick(STYLE_PRESETS).name
    if (!locks.baseColor) patch.baseColor = pick(BASE_COLOR_FAMILIES).name
    if (!locks.theme) patch.theme = pick(NAMED_HUES).name
    if (!locks.chartColor) patch.chartColor = pick(NAMED_HUES).name
    if (!locks.radius) patch.radius = Number((Math.round((Math.random() * 1.5) / 0.05) * 0.05).toFixed(3))
    if (!locks.menuSolid) patch.menuSolid = Math.random() < 0.5
    if (!locks.menuAccent) patch.menuAccent = pick(MENU_ACCENT_LEVELS)
    setBasicOption(patch, isDark)
    return isDark
  }, [locks, setBasicOption])

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

  return { values, setValue, themeName, setThemeName, reset, copyCss, buildCss, adjust, setAdjust, resetAdjust, randomize, basicOptions, setBasicOption, locks, toggleLock, shuffleBasic }
}
