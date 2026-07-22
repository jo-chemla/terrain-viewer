import { useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import { createPortal } from "react-dom"
import { Dice5, Lock, Unlock, Sun, Moon } from "lucide-react"
import { TOKEN_GROUPS, FONT_PRESETS, fontCategoryForKey } from "./token-schema"
import type { TokenDef } from "./types"
import { useThemeEditor, parseNum, type UseThemeEditorOptions } from "./useThemeEditor"
import { hexToOklch, oklchToHex, parseColorToOklch, formatOklch } from "./color-math"
import {
  STYLE_PRESETS, BASE_COLOR_FAMILIES, NAMED_HUES, MENU_ACCENT_LEVELS, type BasicOptions,
  isCustomHueValue, customHueHex, makeCustomHueValue,
} from "./basic-presets"

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
  /** This package has no way to see the host app's own light/dark toggle —
   *  pass this to keep it in sync when Randomize coin-flips a mode. Called
   *  with the mode randomize() just generated colors for. */
  onModeChange?: (isDark: boolean) => void
  /** Named presets to offer in the Basic section's "Load Preset" picker,
   *  grouped under a label (e.g. by source site). This package has no
   *  built-in notion of a preset library (see README) — the host app
   *  supplies its own list and, via onLoadPreset, its own loading mechanism.
   *  Omit to hide the picker entirely. */
  presetGroups?: { label: string; options: { value: string; label: string }[] }[]
  /** Called with a presetGroups option's `value` when picked. Typically this
   *  should just switch the HOST APP's own active theme/preset (e.g. call
   *  through to whatever sets your `data-theme` attribute) — this package's
   *  own MutationObserver on that attribute (see useThemeEditor.ts) then
   *  re-snapshots every token automatically, the same way it already reacts
   *  to any other external preset picker. */
  onLoadPreset?: (value: string) => void
}

const colorGroups = TOKEN_GROUPS.filter((g) => g.category === "color")
const otherGroups = TOKEN_GROUPS.filter((g) => g.category !== "color")

export function ThemeEditorPanel({ onClose, defaultPosition, onSaveTheme, onModeChange, presetGroups, onLoadPreset, ...editorOptions }: ThemeEditorPanelProps) {
  useInjectedStyles()
  const { values, setValue, themeName, setThemeName, reset, copyCss, buildCss, adjust, setAdjust, resetAdjust, basicOptions, setBasicOption, locks, toggleLock, shuffleBasic } = useThemeEditor(editorOptions)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ primary: true })
  const [colorsOpen, setColorsOpen] = useState(false)
  const [basicOpen, setBasicOpen] = useState(true)
  const [adjustOpen, setAdjustOpen] = useState(false)

  // Closing the panel without an explicit Copy/Save should behave like
  // canceling an adjustment layer, not silently leaving every inline
  // --token override sitting on <html> forever — those permanently outrank
  // any [data-theme="…"] rule (including one picked from a plain preset
  // Select afterward), which otherwise reads as "the theme picker stopped
  // working". reset() is captured in a ref so this only ever fires on the
  // actual unmount, not whenever reset's identity happens to change.
  const resetRef = useRef(reset)
  resetRef.current = reset
  useEffect(() => () => { resetRef.current() }, [])

  // The panel's ONE randomize action — shuffles every unlocked Basic-mode
  // field (see the lock toggles next to each Basic row) and coin-flips light/
  // dark itself, so the host app's own toggle always gets kept in sync via
  // onModeChange rather than sometimes drifting from whatever this just
  // generated.
  const handleRandomize = () => {
    const isDark = shuffleBasic()
    onModeChange?.(isDark)
  }

  // Same lightness heuristic setBasicOption/randomize already use to infer
  // mode from the CURRENT palette — good enough for a header icon, not meant
  // to be authoritative (the host app's own toggle state is, which is exactly
  // why this button goes through onModeChange rather than tracking its own
  // separate boolean).
  const isDarkNow = useMemo(() => parseColorToOklch(values.background || "oklch(0.98 0 0)").l < 0.5, [values.background])
  const handleToggleMode = () => onModeChange?.(!isDarkNow)
  const [copied, setCopied] = useState(false)
  const [pos, setPos] = useState(defaultPosition ?? { x: 24, y: 24 })
  // Explicit user-chosen height (via the bottom resize handle). null = use the
  // CSS max-height default.
  const [height, setHeight] = useState<number | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startY: number; origH: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Wheel over a native <select>, <input type=range/color>, or a non-scrolling
  // <textarea> gets consumed by that control (cycles the select, nudges the
  // slider, or just does nothing) instead of scrolling the panel — which read
  // as "mousewheel sometimes doesn't scroll" depending purely on what the
  // cursor happened to be over. A single non-passive wheel listener on the
  // scroll container translates every wheel into a panel scroll itself, only
  // stepping aside for a textarea that genuinely has its own overflow to
  // scroll. Registered natively (not via React's onWheel) because React
  // attaches wheel as passive, so preventDefault() there is a no-op.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null
      const ta = target?.closest?.("textarea")
      if (ta && ta.scrollHeight > ta.clientHeight) return
      el.scrollTop += e.deltaY
      e.preventDefault()
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (d) {
        const panel = panelRef.current
        const maxX = window.innerWidth - (panel?.offsetWidth ?? 320)
        const maxY = window.innerHeight - (panel?.offsetHeight ?? 200)
        setPos({
          x: Math.min(Math.max(0, d.origX + (e.clientX - d.startX)), Math.max(0, maxX)),
          y: Math.min(Math.max(0, d.origY + (e.clientY - d.startY)), Math.max(0, maxY)),
        })
        return
      }
      const rz = resizeRef.current
      if (rz) {
        const top = panelRef.current?.getBoundingClientRect().top ?? 0
        const maxH = window.innerHeight - top - 8
        setHeight(Math.min(Math.max(180, rz.origH + (e.clientY - rz.startY)), Math.max(180, maxH)))
      }
    }
    const onUp = () => { dragRef.current = null; resizeRef.current = null }
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
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation()
    resizeRef.current = { startY: e.clientY, origH: panelRef.current?.offsetHeight ?? 400 }
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
    <div ref={panelRef} className="tec-panel" style={{ left: pos.x, top: pos.y, ...(height != null ? { height, maxHeight: "none" } : {}) }}>
      <div className="tec-header" onPointerDown={startDrag}>
        <span className="tec-title">Theme Editor</span>
        <div className="tec-header-actions">
          {onModeChange && (
            <button type="button" className="tec-icon-btn" onClick={handleToggleMode} title={isDarkNow ? "Switch to light mode" : "Switch to dark mode"}>
              {isDarkNow ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          )}
          <button type="button" className="tec-icon-btn" onClick={handleRandomize} title="Shuffle unlocked Basic-mode fields (see lock icons below)"><Dice5 size={16} /></button>
          <button type="button" className="tec-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      <div className="tec-body" ref={bodyRef}>
        <div className="tec-group">
          <button type="button" className="tec-group-header" onClick={() => setBasicOpen((v) => !v)}>
            <span>Basic</span>
            <span className={`tec-chevron${basicOpen ? " tec-chevron--open" : ""}`}>▾</span>
          </button>
          {basicOpen && (
            <div className="tec-group-body">
              {presetGroups && presetGroups.length > 0 && onLoadPreset && (
                <PresetSelectRow label="Load Preset" groups={presetGroups} onChange={onLoadPreset} />
              )}
              <SelectRow label="Style" value={basicOptions.style} options={STYLE_PRESETS.map((s) => s.name)} onChange={(v) => setBasicOption({ style: v })} locked={locks.style} onToggleLock={() => toggleLock("style")} />
              <SelectRow label="Base Color" value={basicOptions.baseColor} options={BASE_COLOR_FAMILIES.map((b) => b.name)} onChange={(v) => setBasicOption({ baseColor: v })} locked={locks.baseColor} onToggleLock={() => toggleLock("baseColor")} />
              <HueRow label="Theme" value={basicOptions.theme} onChange={(v) => setBasicOption({ theme: v })} locked={locks.theme} onToggleLock={() => toggleLock("theme")} />
              <HueRow label="Chart Color" value={basicOptions.chartColor} onChange={(v) => setBasicOption({ chartColor: v })} locked={locks.chartColor} onToggleLock={() => toggleLock("chartColor")} />
              <SliderRow label="Radius" value={`${basicOptions.radius}`} unit="rem" min={0} max={1.5} step={0.05} onChange={(v) => setBasicOption({ radius: parseNum(v) })} locked={locks.radius} onToggleLock={() => toggleLock("radius")} />
              <SelectRow label="Menu" value={basicOptions.menuSolid ? "Solid" : "Default"} options={["Default", "Solid"]} onChange={(v) => setBasicOption({ menuSolid: v === "Solid" })} locked={locks.menuSolid} onToggleLock={() => toggleLock("menuSolid")} />
              <SelectRow label="Menu Accent" value={basicOptions.menuAccent} options={[...MENU_ACCENT_LEVELS]} onChange={(v) => setBasicOption({ menuAccent: v as BasicOptions["menuAccent"] })} locked={locks.menuAccent} onToggleLock={() => toggleLock("menuAccent")} />
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
        <div className="tec-group">
          <button type="button" className="tec-group-header" onClick={() => setColorsOpen((v) => !v)}>
            <span>Colors</span>
            <span className={`tec-chevron${colorsOpen ? " tec-chevron--open" : ""}`}>▾</span>
          </button>
          {colorsOpen && (
            <div className="tec-subgroups">
              {colorGroups.map((group) => {
                const isOpen = openGroups[group.id] ?? false
                return (
                  <div key={group.id} className="tec-subgroup">
                    <button
                      type="button"
                      className="tec-subgroup-header"
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
          )}
        </div>
        {otherGroups.map((group) => {
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
      {/* Drag the bottom edge to resize the panel vertically. */}
      <div className="tec-resize" onPointerDown={startResize} title="Drag to resize" />
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
    <div className="tec-row tec-row--color">
      <label className="tec-row-label" title={label}>{label}</label>
      <div className="tec-row-control tec-row-control--color">
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

// Shown next to a Basic-mode row when that field is lockable — mirrors
// ui.shadcn.com/create's per-property lock icons, which shuffleBasic() reads
// to decide which fields to leave untouched.
function LockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="tec-icon-btn"
      onClick={onToggle}
      title={locked ? "Locked — won't change on Shuffle" : "Unlocked — will change on Shuffle"}
      aria-pressed={locked}
    >
      {locked ? <Lock size={13} /> : <Unlock size={13} />}
    </button>
  )
}

// Trims float noise for display (e.g. a randomized radius of
// 0.15000000000000002 shows as "0.15"), without changing the stored value.
function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
}

function SliderRow({ label, value, unit, min, max, step, onChange, locked, onToggleLock }: { label: string; value: string; unit: string; min: number; max: number; step: number; onChange: (v: string) => void; locked?: boolean; onToggleLock?: () => void }) {
  const num = parseNum(value || "0")
  return (
    <div className="tec-row">
      <label className="tec-row-label">{label}</label>
      <div className="tec-row-control">
        <input type="range" className="tec-slider" min={min} max={max} step={step} value={num} onChange={(e) => onChange(`${e.target.value}${unit}`)} />
        <span className="tec-value">{formatNum(num)}{unit}</span>
        {onToggleLock && <LockButton locked={!!locked} onToggle={onToggleLock} />}
      </div>
    </div>
  )
}

function SelectRow({ label, value, options, onChange, locked, onToggleLock }: { label: string; value: string; options: string[]; onChange: (v: string) => void; locked?: boolean; onToggleLock?: () => void }) {
  return (
    <div className="tec-row">
      <label className="tec-row-label">{label}</label>
      <div className="tec-row-control">
        <select className="tec-select" style={{ flex: 1 }} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        {onToggleLock && <LockButton locked={!!locked} onToggle={onToggleLock} />}
      </div>
    </div>
  )
}

const CUSTOM_HUE_OPTION = "Custom…"

// Same as SelectRow, but for "Theme"/"Chart Color" specifically — these can
// hold either a curated NAMED_HUES name or an arbitrary user-picked color
// (see basic-presets.ts's makeCustomHueValue/isCustomHueValue), so this adds
// a "Custom…" option that reveals a color swatch for that arbitrary pick.
function HueRow({ label, value, onChange, locked, onToggleLock }: { label: string; value: string; onChange: (v: string) => void; locked?: boolean; onToggleLock?: () => void }) {
  const isCustom = isCustomHueValue(value)
  const hex = isCustom ? customHueHex(value) : "#3388ff"
  return (
    <div className="tec-row">
      <label className="tec-row-label">{label}</label>
      <div className="tec-row-control">
        <select
          className="tec-select"
          style={{ flex: 1 }}
          value={isCustom ? CUSTOM_HUE_OPTION : value}
          onChange={(e) => onChange(e.target.value === CUSTOM_HUE_OPTION ? makeCustomHueValue(hex) : e.target.value)}
        >
          {NAMED_HUES.map((h) => <option key={h.name} value={h.name}>{h.name}</option>)}
          <option value={CUSTOM_HUE_OPTION}>{CUSTOM_HUE_OPTION}</option>
        </select>
        {isCustom && (
          <input
            type="color"
            className="tec-swatch"
            value={hex}
            onChange={(e) => onChange(makeCustomHueValue(e.target.value))}
          />
        )}
        {onToggleLock && <LockButton locked={!!locked} onToggle={onToggleLock} />}
      </div>
    </div>
  )
}

// Ephemeral picker, same idea as FontRow's "Quick pick…" — always resets to
// the blank option after firing, since there's no single persistent "current
// preset" value to reflect back once loaded (loading one changes dozens of
// tokens at once, any of which the user may then hand-edit).
function PresetSelectRow({ label, groups, onChange }: { label: string; groups: { label: string; options: { value: string; label: string }[] }[]; onChange: (v: string) => void }) {
  return (
    <div className="tec-row">
      <label className="tec-row-label">{label}</label>
      <div className="tec-row-control">
        <select
          className="tec-select"
          style={{ flex: 1 }}
          value=""
          onChange={(e) => { if (e.target.value) onChange(e.target.value) }}
        >
          <option value="">Quick pick…</option>
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </optgroup>
          ))}
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
  /* Must outrank shadcn/Radix Dialog's overlay+content (z-50 — see
     components/ui/dialog.tsx), including when this panel is opened from a
     button INSIDE an already-open Settings dialog. Both are portaled
     directly to <body> as siblings, so a numeric z-index comparison is all
     that's needed — !important guards against Radix ever applying its own
     higher-specificity inline style to elements it doesn't recognize as part
     of its own modal stack (this panel uses a hand-rolled createPortal, not
     Radix's own Portal primitive). pointer-events is set explicitly for the
     same reason: a modal Dialog can otherwise leave stray "inert" styling on
     body-level siblings it doesn't manage. */
  z-index: 2147483000 !important;
  pointer-events: auto !important;
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
/* Browsers don't inherit font-family into form controls by default (button/
   input/select/textarea use the OS UI font instead) — the main app gets this
   reset for free from Tailwind's Preflight, but this panel is a standalone
   stylesheet with no Preflight of its own, so every dropdown/button/input in
   here silently ignored the chosen --font-sans until this was added. */
.tec-panel button, .tec-panel input, .tec-panel select, .tec-panel textarea {
  font-family: inherit;
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
  flex-shrink: 0;
}
.tec-icon-btn:hover { background: var(--accent, #e5e5e5); }
.tec-body {
  /* flex:1 + min-height:0 give the body a bounded height inside the panel's
     max-height, which is what actually makes overflow-y kick in — without it
     the content just overran the panel and the wheel had nothing to scroll. */
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; padding: 4px 0;
  overscroll-behavior: contain;
  /* Themed scrollbar, same reasoning as the host app's own (src/index.css) —
     this panel is a standalone stylesheet with no Tailwind of its own, so it
     needs its own copy rather than inheriting the app's rule. */
  scrollbar-width: thin;
  scrollbar-color: var(--muted-foreground, #888) var(--background, #fff);
}
.tec-body::-webkit-scrollbar { width: 10px; }
.tec-body::-webkit-scrollbar-track { background: var(--background, #fff); }
.tec-body::-webkit-scrollbar-thumb { background: var(--muted-foreground, #888); border-radius: 8px; }
.tec-body::-webkit-scrollbar-thumb:hover { background: var(--primary, #666); }
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
.tec-subgroups { padding: 2px 0 4px; }
.tec-subgroup { border-top: 1px solid var(--border, #f0f0f0); }
.tec-subgroup-header {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  background: transparent; border: none; cursor: pointer; color: inherit;
  padding: 6px 10px 6px 20px; font-weight: 500; font-size: 11.5px;
}
.tec-subgroup-header:hover { background: var(--accent, #f0f0f0); }
.tec-subgroup .tec-group-body { padding-left: 20px; }
.tec-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tec-row--stacked { flex-direction: column; align-items: stretch; gap: 4px; }
.tec-row-label { flex: 0 0 auto; min-width: 92px; color: var(--muted-foreground, #666); }
.tec-row-control { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.tec-swatch { width: 24px; height: 24px; padding: 0; border: 1px solid var(--border, #ccc); border-radius: 4px; cursor: pointer; background: none; flex: 0 0 auto; }
.tec-text-input {
  flex: 1; min-width: 0; padding: 3px 6px; border: 1px solid var(--border, #ccc); border-radius: 4px;
  background: var(--background, #fff); color: var(--foreground, #111); font-size: 12px;
}
/* .tec-panel-prefixed so these beat the ".tec-panel input/textarea { font-family:
   inherit }" reset above on specificity (two classes > one class + one type)
   rather than depending on declaration order, which a future reordering could
   silently break. */
.tec-panel .tec-text-input--mono { font-family: var(--font-mono, ui-monospace, monospace); }
.tec-textarea {
  width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid var(--border, #ccc); border-radius: 4px;
  background: var(--background, #fff); color: var(--foreground, #111); font-size: 11px;
}
.tec-panel .tec-textarea { font-family: var(--font-mono, ui-monospace, monospace); resize: vertical; }
.tec-select {
  padding: 3px 6px; border: 1px solid var(--border, #ccc); border-radius: 4px;
  background: var(--background, #fff); color: var(--foreground, #111); font-size: 12px;
}
/* min-width:0 is essential: a native range input has an intrinsic min-width
   (~129px) so with plain flex:1 it refuses to shrink, pushing the value+lock
   past the 320px panel edge (the "radius lock misplaced / rem text overflows"
   report). Allowing it to shrink keeps the value and the right-aligned lock in
   the row and aligned with every other row's lock. */
.tec-slider { flex: 1 1 0; min-width: 0; accent-color: var(--primary, #666); }
/* white-space: nowrap matters here — without it, a longer value+unit string
   (e.g. Radius's "0.625rem", the longest of any SliderRow's unit) can wrap
   onto two lines inside this flex item's constrained width, making the row
   taller than its sibling lock button and throwing off their vertical
   alignment (align-items: center on .tec-row-control then centers the lock
   button against a taller box instead of a single text line). min-width
   bumped so a two-decimal "rem" value never needs to wrap or grow at all. */
.tec-value { flex: 0 0 auto; min-width: 54px; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted-foreground, #666); font-size: 11px; }
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
/* Bottom-edge vertical resize grip. */
.tec-resize {
  position: absolute; left: 0; right: 0; bottom: 0; height: 8px;
  cursor: ns-resize; touch-action: none;
}
.tec-resize::after {
  content: ""; position: absolute; left: 50%; bottom: 2px; transform: translateX(-50%);
  width: 28px; height: 3px; border-radius: 2px; background: var(--border, #ccc);
}
/* Color rows: hex input fills, swatch sits at the far right so every color
   row's picker lines up in a single right-aligned column. The control column
   is a FIXED width (not flex:1) and the label takes the slack + ellipsizes —
   otherwise a longer label ("Sidebar Primary Foreground") ate into the
   content-sized label's neighbour and left the hex input narrower than a
   short-label row's ("the hex inputs are not always the same size" report).
   Pinning the control width makes every hex input identical regardless of
   label length; the label still shows its full text on hover (title attr). */
.tec-row--color .tec-row-label {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tec-row-control--color { flex: 0 0 172px; justify-content: flex-end; }
.tec-row-control--color .tec-text-input { flex: 1 1 auto; min-width: 0; }
.tec-row-control--color .tec-swatch { order: 2; }
`
