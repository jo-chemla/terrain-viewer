import { useCallback, useEffect, useMemo, useState } from "react"
import { TOKEN_GROUPS, SHADOW_BASE_KEYS } from "./token-schema"
import { deriveShadowTiers, shadowVarName, SHADOW_TIER_KEYS, type ShadowBase } from "./shadow-formula"

export function parseNum(value: string): number {
  const m = value.match(/-?[\d.]+/)
  return m ? parseFloat(m[0]) : 0
}

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

  useEffect(() => {
    if (!target || typeof MutationObserver === "undefined") return
    const observer = new MutationObserver(() => {
      setThemeName(target.getAttribute(themeAttribute) ?? "custom")
      setValues(readAll())
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

  const reset = useCallback(() => {
    if (!target) return
    for (const key of allKeys) target.style.removeProperty(`--${key}`)
    for (const tier of SHADOW_TIER_KEYS) target.style.removeProperty(shadowVarName(tier))
    setValues(readAll())
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

  return { values, setValue, themeName, setThemeName, reset, copyCss, buildCss }
}
