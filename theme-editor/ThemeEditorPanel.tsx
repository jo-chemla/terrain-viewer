import { useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import { createPortal } from "react-dom"
import { TOKEN_GROUPS, FONT_PRESETS, fontCategoryForKey } from "./token-schema"
import type { TokenDef } from "./types"
import { useThemeEditor, parseNum, type UseThemeEditorOptions } from "./useThemeEditor"
import { hexToOklch, oklchToHex, parseColorToOklch, formatOklch } from "./color-math"
import { STYLE_PRESETS, BASE_COLOR_FAMILIES, NAMED_HUES, MENU_ACCENT_LEVELS, type BasicOptions } from "./basic-presets"

const STYLE_ID = "theme-editor-panel-styles"

// Injected once per page (keyed by id) rather than requiring the host app to
// import a stylesheet — this is what keeps the package a single droppable
// .tsx folder. Reads the app's OWN --background/--foreground/etc. tokens for
// its own chrome (with hard fallbacks, in case those aren't defined yet),
// so the panel re-themes itself live as you edit — and needs no Tailwind.
function useInjectedStyles() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = PANEL_CSS
    document.head.appendChild(style)
  }, [])
}

export type ThemeEditorPanelProps = UseThemeEditorOptions & {
  onClose: () => void
  /** Initial screen position of the panel's top-left corner. */
  defaultPosition?: { x: number; y: number }
  /** Persistence is deliberately NOT built into this package (see README) —
   *  pass this to hook up your own storage. Called with the current preset
   *  name and a ready-to-use CSS string containing BOTH `-light`/`-dark`
   *  variants (built from whichever single mode is live right now — the
   *  other variant is a copy, not independently tuned). Omit to hide the
   *  Save button entirely. */
  onSaveTheme?: (name: string, css: string) => void
}

export function ThemeEditorPanel({ onClose, defaultPosition, onSaveTheme, ...editorOptions }: ThemeEditorPanelProps) {
  useInjectedStyles()
  const { values, setValue, themeName, setThemeName, reset, copyCss, buildCss, adjust, setAdjust, resetAdjust, randomize, basicOptions, setBasicOption } = useThemeEditor(editorOptions)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ primary: true })
  const [basicOpen, setBasicOpen] = useState(true)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pos, setPos] = useState(defaultPosition ?? { x: 24, y: 24 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const panel = panelRef.current
      const maxX = window.innerWidth - (panel?.offsetWidth ?? 320)
      const maxY = window.innerHeight - (panel?.offsetHeight ?? 200)
      setPos({
        x: Math.min(Math.max(0, d.origX + (e.clientX - d.startX)), Math.max(0, maxX)),
        y: Math.min(Math.max(0, d.origY + (e.clientY - d.startY)), Math.max(0, maxY)),
      })
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [])

  const startDrag = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }

  const [copyFailed, setCopyFailed] = useState(false)
  const handleCopy = async () => {
    const { css, copied: didCopy } = await copyCss()
    if (!didCopy) console.info("[theme-editor] Clipboard write failed — CSS:\n" + css)
    setCopied(didCopy)
    setCopyFailed(!didCopy)
    setTimeout(() => { setCopied(false); setCopyFailed(false) }, 1500)
  }

  const [saved, setSaved] = useState(false)
  const handleSave = () => {
    if (!onSaveTheme) return
    const css = `${buildCss(`${themeName}-light`)}\n\n${buildCss(`${themeName}-dark`)}`
    onSaveTheme(themeName, css)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  // Portaled to <body> rather than rendered inline — `position: fixed` is only
  // relative to the true viewport when NO ancestor has a transform/filter/
  // will-change/contain (a very common thing for an animated sidebar to have
  // on its slide-in panel), otherwise it silently rebases to that ancestor's
  // box instead. Escaping to <body> is what keeps this genuinely drop-in
  // safe regardless of where the host app happens to mount it from.
  return createPortal(
    <div ref={panelRef} className="tec-panel" style={{ left: pos.x, top: pos.y }}>
      <div className="tec-header" onPointerDown={startDrag}>
        <span className="tec-title">Theme Editor</span>
        <div className="tec-header-actions">
          <button type="button" className="tec-icon-btn" onClick={randomize} title="Randomize the whole palette">🎲</button>
          <button type="button" className="tec-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      <div className="tec-body">
        <div className="tec-group">
          <button type="button" className="tec-group-header" onClick={() => setBasicOpen((v) => !v)}>
            <span>Basic</span>
            <span className={`tec-chevron${basicOpen ? " tec-chevron--open" : ""}`}>▾</span>
          </button>
          {basicOpen && (
            <div className="tec-group-body">
              <SelectRow label="Style" value={basicOptions.style} options={STYLE_PRESETS.map((s) => s.name)} onChange={(v) => setBasicOption({ style: v })} />
              <SelectRow label="Base Color" value={basicOptions.baseColor} options={BASE_COLOR_FAMILIES.map((b) => b.name)} onChange={(v) => setBasicOption({ baseColor: v })} />
              <SelectRow label="Theme" value={basicOptions.theme} options={NAMED_HUES.map((h) => h.name)} onChange={(v) => setBasicOption({ theme: v })} />
              <SelectRow label="Chart Color" value={basicOptions.chartColor} options={NAMED_HUES.map((h) => h.name)} onChange={(v) => setBasicOption({ chartColor: v })} />
              <SliderRow label="Radius" value={`${basicOptions.radius}`} unit="rem" min={0} max={1.5} step={0.05} onChange={(v) => setBasicOption({ radius: parseNum(v) })} />
              <SelectRow label="Menu" value={basicOptions.menuSolid ? "Solid" : "Default"} options={["Default", "Solid"]} onChange={(v) => setBasicOption({ menuSolid: v === "Solid" })} />
              <SelectRow label="Menu Accent" value={basicOptions.menuAccent} options={[...MENU_ACCENT_LEVELS]} onChange={(v) => setBasicOption({ menuAccent: v as BasicOptions["menuAccent"] })} />
            </div>
          )}
        </div>
        <div className="tec-group">
          <button type="button" className="tec-group-header" onClick={() => setAdjustOpen((v) => !v)}>
            <span>Adjust (Hue / Saturation / Lightness)</span>
            <span className={`tec-chevron${adjustOpen ? " tec-chevron--open" : ""}`}>▾</span>
          </button>
          {adjustOpen && (
            <div className="tec-group-body">
              <SliderRow label="Hue" value={`${adjust.hue}`} unit="°" min={-180} max={180} step={1} onChange={(v) => setAdjust({ ...adjust, hue: parseNum(v) })} />
              <SliderRow label="Saturation" value={`${adjust.saturation}`} unit="×" min={0} max={2} step={0.05} onChange={(v) => setAdjust({ ...adjust, saturation: parseNum(v) })} />
              <SliderRow label="Lightness" value={`${adjust.lightness}`} unit="×" min={0.5} max={1.5} step={0.05} onChange={(v) => setAdjust({ ...adjust, lightness: parseNum(v) })} />
              <button type="button" className="tec-btn" onClick={resetAdjust}>Reset Adjust</button>
            </div>
          )}
        </div>
        {TOKEN_GROUPS.map((group) => {
          const isOpen = openGroups[group.id] ?? false
          return (
            <div key={group.id} className="tec-group">
              <button
                type="button"
                className="tec-group-header"
                onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !isOpen }))}
              >
                <span>{group.title}</span>
                <span className={`tec-chevron${isOpen ? " tec-chevron--open" : ""}`}>▾</span>
              </button>
              {isOpen && (
                <div className="tec-group-body">
                  {group.tokens.map((token) => (
                    <TokenRow key={token.key} token={token} value={values[token.key] ?? ""} onChange={(v) => setValue(token.key, v)} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="tec-footer">
        <input
          type="text"
          className="tec-text-input"
          value={themeName}
          onChange={(e) => setThemeName(e.target.value)}
          placeholder="theme-name"
          title="Preset name used in the exported CSS selector"
        />
        <div className="tec-footer-row">
          <button type="button" className="tec-btn" onClick={reset}>Reset</button>
          <button type="button" className="tec-btn" onClick={handleCopy} title={copyFailed ? "Clipboard write failed — check the console for the CSS" : undefined}>
            {copied ? "Copied!" : copyFailed ? "Copy failed" : "Copy CSS"}
          </button>
          {onSaveTheme && (
            <button type="button" className="tec-btn tec-btn--primary" onClick={handleSave}>
              {saved ? "Saved!" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function TokenRow({ token, value, onChange }: { token: TokenDef; value: string; onChange: (v: string) => void }) {
  if (token.type === "color" || token.type === "shadow-color") {
    return <ColorRow label={token.label} value={value} onChange={onChange} />
  }
  if (token.type === "length") {
    return <SliderRow label={token.label} value={value} unit={token.unit} min={token.min} max={token.max} step={token.step} onChange={onChange} />
  }
  if (token.type === "shadow-opacity" || token.type === "shadow-length" || token.type === "shadow-offset") {
    const unit = token.type === "shadow-opacity" ? "" : "px"
    return <SliderRow label={token.label} value={value} unit={unit} min={token.min ?? 0} max={token.max ?? 1} step={token.step ?? 0.01} onChange={onChange} />
  }
  if (token.type === "font") {
    return <FontRow label={token.label} value={value} onChange={onChange} presets={FONT_PRESETS[fontCategoryForKey(token.key)]} />
  }
  return null
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const oklch = useMemo(() => parseColorToOklch(value || "oklch(0.5 0 0)"), [value])
  const hex = useMemo(() => oklchToHex(oklch), [oklch])
  return (
    <div className="tec-row">
      <label className="tec-row-label">{label}</label>
      <div className="tec-row-control">
        <input
          type="color"
          className="tec-swatch"
          value={hex}
          onChange={(e) => onChange(formatOklch({ ...hexToOklch(e.target.value), alpha: oklch.alpha }))}
        />
        <input type="text" className="tec-text-input tec-text-input--mono" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      </div>
    </div>
  )
}

function SliderRow({ label, value, unit, min, max, step, onChange }: { label: string; value: string; unit: string; min: number; max: number; step: number; onChange: (v: string) => void }) {
  const num = parseNum(value || "0")
  return (
    <div className="tec-row">
      <label className="tec-row-label">{label}</label>
      <div className="tec-row-control">
        <input type="range" className="tec-slider" min={min} max={max} step={step} value={num} onChange={(e) => onChange(`${e.target.value}${unit}`)} />
        <span className="tec-value">{num}{unit}</span>
      </div>
    </div>
  )
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="tec-row">
      <label className="tec-row-label">{label}</label>
      <div className="tec-row-control">
        <select className="tec-select" style={{ flex: 1 }} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    </div>
  )
}

function FontRow({ label, value, onChange, presets }: { label: string; value: string; onChange: (v: string) => void; presets: Record<string, string> }) {
  return (
    <div className="tec-row tec-row--stacked">
      <label className="tec-row-label">{label}</label>
      <select className="tec-select" value="" onChange={(e) => { if (e.target.value) onChange(presets[e.target.value]) }}>
        <option value="">Quick pick…</option>
        {Object.keys(presets).map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <textarea className="tec-textarea" value={value} onChange={(e) => onChange(e.target.value)} rows={2} spellCheck={false} />
    </div>
  )
}

const PANEL_CSS = `
.tec-panel {
  position: fixed;
  z-index: 2147483000;
  width: 320px;
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--popover, #fff);
  color: var(--popover-foreground, #111);
  border: 1px solid var(--border, #ddd);
  border-radius: var(--radius, 0.5rem);
  box-shadow: var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.25));
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 13px;
}
.tec-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; cursor: grab; user-select: none;
  border-bottom: 1px solid var(--border, #ddd);
  border-radius: var(--radius, 0.5rem) var(--radius, 0.5rem) 0 0;
  background: var(--muted, #f5f5f5); color: var(--muted-foreground, #333);
  touch-action: none;
}
.tec-header:active { cursor: grabbing; }
.tec-title { font-weight: 600; }
.tec-header-actions { display: flex; align-items: center; gap: 2px; }
.tec-icon-btn {
  background: transparent; border: none; cursor: pointer; color: inherit;
  font-size: 14px; line-height: 1; padding: 2px 6px; border-radius: 4px;
}
.tec-icon-btn:hover { background: var(--accent, #e5e5e5); }
.tec-body { overflow-y: auto; padding: 4px 0; }
.tec-group { border-bottom: 1px solid var(--border, #eee); }
.tec-group-header {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  background: transparent; border: none; cursor: pointer; color: inherit;
  padding: 8px 10px; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.02em;
}
.tec-group-header:hover { background: var(--accent, #f0f0f0); }
.tec-chevron { transition: transform 120ms ease; display: inline-block; }
.tec-chevron--open { transform: rotate(180deg); }
.tec-group-body { padding: 2px 10px 8px; display: flex; flex-direction: column; gap: 8px; }
.tec-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tec-row--stacked { flex-direction: column; align-items: stretch; gap: 4px; }
.tec-row-label { flex: 0 0 auto; min-width: 92px; color: var(--muted-foreground, #666); }
.tec-row-control { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.tec-swatch { width: 24px; height: 24px; padding: 0; border: 1px solid var(--border, #ccc); border-radius: 4px; cursor: pointer; background: none; flex: 0 0 auto; }
.tec-text-input {
  flex: 1; min-width: 0; padding: 3px 6px; border: 1px solid var(--border, #ccc); border-radius: 4px;
  background: var(--background, #fff); color: var(--foreground, #111); font-size: 12px;
}
.tec-text-input--mono { font-family: var(--font-mono, ui-monospace, monospace); }
.tec-textarea {
  width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid var(--border, #ccc); border-radius: 4px;
  background: var(--background, #fff); color: var(--foreground, #111); font-size: 11px;
  font-family: var(--font-mono, ui-monospace, monospace); resize: vertical;
}
.tec-select {
  padding: 3px 6px; border: 1px solid var(--border, #ccc); border-radius: 4px;
  background: var(--background, #fff); color: var(--foreground, #111); font-size: 12px;
}
.tec-slider { flex: 1; accent-color: var(--primary, #666); }
.tec-value { flex: 0 0 auto; min-width: 44px; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted-foreground, #666); font-size: 11px; }
.tec-footer {
  display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;
  border-top: 1px solid var(--border, #ddd);
  border-radius: 0 0 var(--radius, 0.5rem) var(--radius, 0.5rem);
}
.tec-footer .tec-text-input { min-width: 0; }
.tec-footer-row { display: flex; align-items: center; gap: 6px; }
.tec-footer-row .tec-btn { flex: 1; }
.tec-btn {
  padding: 5px 10px; border-radius: 4px; border: 1px solid var(--border, #ccc);
  background: var(--secondary, #eee); color: var(--secondary-foreground, #111);
  cursor: pointer; font-size: 12px; white-space: nowrap; flex: 0 0 auto;
}
.tec-btn:hover { filter: brightness(0.95); }
.tec-btn--primary { background: var(--primary, #333); color: var(--primary-foreground, #fff); border-color: transparent; }
`
