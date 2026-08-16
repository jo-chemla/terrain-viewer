import type React from "react"
import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { useAtom, useAtomValue, useSetAtom, type PrimitiveAtom } from "jotai"
import { Moon, Sun, Settings, ExternalLink, Trash2, ChevronDown, ChevronsDownUp, ChevronsUpDown, Sparkles, Compass, BookOpen } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  mapboxKeyAtom, googleKeyAtom, maptilerKeyAtom, hereKeyAtom, planetKeyAtom, titilerEndpointAtom,
  useCogProtocolVsTitilerAtom, transparentUiAtom, highResTerrainAtom,
  useClientExportAtom, customTerrainSourcesAtom, customBasemapSourcesAtom, cacheVizTilesAtom,
  customThemesAtom,
  isSettingsAppearanceOpenAtom, isSettingsKeyboardShortcutsOpenAtom, isSettingsVisualizationModesOpenAtom,
  isSettingsStreamingOpenAtom, isSettingsStoragePersistenceOpenAtom, isSettingsBetaOpenAtom,
  isSettingsApiKeysOpenAtom, isSettingsMapBoundsOpenAtom,
  isSettingsSaveProjectOpenAtom, isSettingsResourcesOpenAtom, isSettingsGeomorphometryOpenAtom,
  isSettingsWhatsNewOpenAtom, lastSeenChangelogAtAtom, changelogViewAtom, changelogEntriesOpenAtom,
  isTourOpenAtom,
} from "@/lib/settings-atoms"
import { CHANGELOG_ENTRIES, LATEST_CHANGELOG_RELEASED_AT, type ChangelogEntry } from "@/lib/changelog"
import { MAX_BOUNDS_MODES, type MaxBoundsMode } from "@/lib/max-bounds"
import { persistLocalCogsAtom } from "@/lib/local-file-store"
import { isOpfsSupported, estimateStorage, listPersistedCogs, clearAllPersistedCogs, formatBytes } from "@/lib/opfs-file-store"
import { listPersistedVectorLayers, clearAllPersistedVectorLayers } from "@/lib/opfs-vector-store"
import { persistVectorLayersAtom } from "./TerraDrawSystem"
import { useTheme } from "@/lib/controls-utils"
import { PasswordInput, SegmentedToggle } from "./controls-components"
import { TooltipIconButton } from "./controls-components"
import { JsonEditor } from "@/components/ui/json-editor"
import { ColorThemeSelect, SOURCE_GROUPS, DEFAULT_GROUP_SOURCES } from "@/components/theme-switcher"
import { useTheme as useColorTheme } from "@/components/theme-provider"
import { ThemeEditorPanel } from "@/theme-editor"
import { sortedThemes } from "@/lib/themes-config"
import { stripFrontmatter } from "@/lib/shared-docs"
import keyboardShortcutsRaw from "@/docs/content/docs/keyboard-shortcuts.mdx?raw"
import resourcesMaplibreRaw from "@/docs/content/docs/resources/maplibre.mdx?raw"
import resourcesGeomorphometryRaw from "@/docs/content/docs/resources/geomorphometry.mdx?raw"
import creditsRaw from "@/docs/content/docs/resources/credits.mdx?raw"
import vizModesDescriptionRaw from "@/docs/content/docs/features/visualization-modes-description.mdx?raw"

// Single source of truth for these 4 sections lives in docs/content/docs/
// (rendered as real Fumadocs pages there too) — see lib/shared-docs.ts.
const KEYBOARD_SHORTCUTS_MARKDOWN = stripFrontmatter(keyboardShortcutsRaw)
const RESOURCES_MAPLIBRE_MARKDOWN = stripFrontmatter(resourcesMaplibreRaw)
const RESOURCES_GEOMORPHOMETRY_MARKDOWN = stripFrontmatter(resourcesGeomorphometryRaw)
export const CREDITS_MARKDOWN = stripFrontmatter(creditsRaw)
const VISUALIZATION_MODES_DESCRIPTION_MARKDOWN = stripFrontmatter(vizModesDescriptionRaw)

// Renders each shortcut as a plain stacked row (no bullet marker) with every
// backtick-code key styled as a keycap — matches the look every key already
// had before this content moved into shared markdown.
const KEYBOARD_SHORTCUTS_MARKDOWN_COMPONENTS = {
  ul: ({ children }: any) => <div className="space-y-1.5 text-xs text-muted-foreground">{children}</div>,
  li: ({ children }: any) => <div>{children}</div>,
  code: ({ children }: any) => <kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">{children}</kbd>,
}

// Renders each link as a full-width row with a trailing external-link icon —
// the same shape every resource link already had as hand-written JSX. Only
// fits documents that are a flat one-link-per-bullet list (Resources), not
// credits.mdx's multi-link bullets (Codetard, Mike Jenkin) — those need
// CREDITS_MARKDOWN_COMPONENTS's plain inline-link treatment instead.
const RESOURCE_LINKS_MARKDOWN_COMPONENTS = {
  ul: ({ children }: any) => <div className="space-y-2 text-sm">{children}</div>,
  li: ({ children }: any) => <>{children}</>,
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
      <span>{children}</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
    </a>
  ),
}

// footer-section.tsx's "Made by / Also see / Inspired by" credits — plain
// underlined inline links (a bullet can hold several) instead of the
// one-icon-per-row treatment above.
export const CREDITS_MARKDOWN_COMPONENTS = {
  h3: ({ children }: any) => <p className="pt-1">{children}:</p>,
  ul: ({ children }: any) => <ul className="list-disc pl-6 space-y-0.5">{children}</ul>,
  a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">{children}</a>,
}

// Visualization Modes section body — matches the original hand-written JSX's
// look (uppercase-tracking-wide mini group headers, bold term + muted
// definition rows) closely enough that this markdown source is a drop-in
// replacement, not just a same-wording approximation.
const VIZ_MODES_DESCRIPTION_MARKDOWN_COMPONENTS = {
  h3: ({ children }: any) => <div className="pt-2 text-xs font-semibold text-foreground">{children}</div>,
  h4: ({ children }: any) => <div className="pt-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{children}</div>,
  p: ({ children }: any) => <p className="text-xs text-muted-foreground">{children}</p>,
  ul: ({ children }: any) => <ul className="list-disc pl-5 space-y-1.5 text-xs text-muted-foreground">{children}</ul>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
  code: ({ children }: any) => <code className="bg-muted px-1 rounded text-xs">{children}</code>,
  strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
}

// Built once at module scope (sortedThemes never changes at runtime) — the
// Basic section's "Load Preset" picker in the advanced theme editor, grouped
// the same way as ColorThemeSelect's own dropdown for a consistent picture of
// where each preset came from. sortedThemes[0] is always the app's own
// baseline "Default" theme — pulled into its own leading group instead of
// being lumped inside "tweakcn.com" (see theme-switcher.tsx's ColorThemeSelect
// for the same treatment).
const PRESET_GROUPS = [
  {
    label: "Default",
    options: [sortedThemes[0], ...sortedThemes.slice(1).filter((t) => t.source && DEFAULT_GROUP_SOURCES.has(t.source))]
      .map((t) => ({ value: t.name, label: t.title })),
  },
  ...SOURCE_GROUPS
    .map((group) => ({
      label: group.label,
      options: sortedThemes.slice(1).filter((t) => (t.source ?? "tweakcn") === group.key).map((t) => ({ value: t.name, label: t.title })),
    }))
    .filter((group) => group.options.length > 0),
]

// Every top-level settings section folds independently, persisted via its own
// atomWithStorage (lib/settings-atoms.ts) so the collapsed/expanded state
// survives a dialog close/reopen and a page reload.
const CollapsibleSection: React.FC<{
  title: string
  openAtom: PrimitiveAtom<boolean>
  headerExtra?: React.ReactNode
  contentClassName?: string
  children: React.ReactNode
}> = ({ title, openAtom, headerExtra, contentClassName = "space-y-3 pt-2", children }) => {
  const [isOpen, setIsOpen] = useAtom(openAtom)
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer">
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
          <h3 className="text-sm font-semibold">{title}</h3>
        </CollapsibleTrigger>
        {headerExtra}
      </div>
      <CollapsibleContent className={contentClassName}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

// Shared markdown-element styling for changelog TL;DR bullets — this dialog has
// no markdown renderer anywhere else, so these mirror the same text-xs/text-sm/
// text-muted-foreground conventions already used throughout it rather than
// pulling in a typography plugin for one section. Only inline-level elements:
// a TL;DR block is always just a bullet list (see lib/changelog.ts), never
// headings/paragraphs.
// `onImageClick` is threaded in from SettingsDialog rather than reading/
// writing a module-level ref — a screenshot/gif is embedded at whatever width
// fits the TL;DR bullet list (see the `img` renderer below), far too small to
// actually read, so clicking one opens it full-size in the lightbox dialog
// instead (see SettingsDialog's lightboxImage state).
function changelogMarkdownComponents(onImageClick: (src: string, alt?: string) => void) {
  return {
    ul: ({ children }: any) => <ul className="list-disc pl-4 space-y-1.5 text-sm text-muted-foreground">{children}</ul>,
    strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
    code: ({ children }: any) => <code className="bg-muted px-1 rounded text-xs">{children}</code>,
    a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>,
    img: ({ src, alt }: any) => (
      <img
        src={src}
        alt={alt}
        className="rounded border max-w-full my-2 cursor-zoom-in hover:opacity-90 transition-opacity"
        onClick={() => onImageClick(src, alt)}
      />
    ),
  }
}

// Renders a list of changelog entries as heading + TL;DR-only markdown — used
// for both the "since you last looked" highlights and the "full changelog"
// view (settings-dialog.tsx never renders the dev-oriented Features/Bug Fixes
// prose from CHANGELOG.md).
const ChangelogEntryList: React.FC<{ entries: ChangelogEntry[]; onImageClick: (src: string, alt?: string) => void }> = ({ entries, onImageClick }) => {
  const markdownComponents = useMemo(() => changelogMarkdownComponents(onImageClick), [onImageClick])
  const [entriesOpen, setEntriesOpen] = useAtom(changelogEntriesOpenAtom)
  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const key = entry.releasedAt
        const isOpen = entriesOpen[key] ?? true // missing key = expanded by default
        return (
          <div key={key} className="space-y-1.5">
            <div
              className="flex items-center gap-2 flex-wrap cursor-pointer"
              onClick={() => setEntriesOpen((prev) => ({ ...prev, [key]: !isOpen }))}
            >
              <Badge variant="secondary" className="rounded-full">{entry.releasedDate}</Badge>
              <span className="text-xs font-semibold text-foreground flex-1 min-w-0">{entry.heading}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
            </div>
            {isOpen && (
              entry.tldrMarkdown ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {entry.tldrMarkdown}
                </ReactMarkdown>
              ) : (
                <p className="text-xs text-muted-foreground italic">No summary for this release yet.</p>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}

export const SettingsDialog: React.FC<{ isOpen: boolean; onOpenChange: (open: boolean) => void; state: any, setState: any; historicalMode?: boolean }> = ({ isOpen, onOpenChange, state, setState, historicalMode = false }) => {
  const { theme, toggleTheme, setTheme: setAppTheme } = useTheme()
  const { setTheme: setColorTheme } = useColorTheme()
  const [showThemeEditor, setShowThemeEditor] = useState(false)
  const setCustomThemes = useSetAtom(customThemesAtom)
  const setIsTourOpen = useSetAtom(isTourOpenAtom)

  // Fold-all/expand-all for the settings dialog's own sections — same idea as
  // the sidebar's chevron button (TerrainControlPanel.tsx). Each of these is a
  // PrimitiveAtom<boolean>-shaped view onto one field of the single coalesced
  // "settingsSectionsOpen" atom (see lib/settings-atoms.ts's booleanField).
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useAtom(isSettingsWhatsNewOpenAtom)
  const [isAppearanceOpen, setIsAppearanceOpen] = useAtom(isSettingsAppearanceOpenAtom)
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useAtom(isSettingsKeyboardShortcutsOpenAtom)
  const [isVisualizationModesOpen, setIsVisualizationModesOpen] = useAtom(isSettingsVisualizationModesOpenAtom)
  const [isStreamingOpen, setIsStreamingOpen] = useAtom(isSettingsStreamingOpenAtom)
  const [isStoragePersistenceOpen, setIsStoragePersistenceOpen] = useAtom(isSettingsStoragePersistenceOpenAtom)
  const [isBetaOpen, setIsBetaOpen] = useAtom(isSettingsBetaOpenAtom)
  const [isApiKeysOpen, setIsApiKeysOpen] = useAtom(isSettingsApiKeysOpenAtom)
  const [isMapBoundsOpen, setIsMapBoundsOpen] = useAtom(isSettingsMapBoundsOpenAtom)
  const [isSaveProjectOpen, setIsSaveProjectOpen] = useAtom(isSettingsSaveProjectOpenAtom)
  const [isResourcesOpen, setIsResourcesOpen] = useAtom(isSettingsResourcesOpenAtom)
  const [isGeomorphometryOpen, setIsGeomorphometryOpen] = useAtom(isSettingsGeomorphometryOpenAtom)
  const settingsSectionOpenStates = [
    isWhatsNewOpen, isAppearanceOpen, isKeyboardShortcutsOpen, isVisualizationModesOpen, isStreamingOpen,
    isStoragePersistenceOpen, isBetaOpen,
    isApiKeysOpen, isMapBoundsOpen, isSaveProjectOpen, isResourcesOpen, isGeomorphometryOpen,
  ]
  const settingsSectionSetters = [
    setIsWhatsNewOpen, setIsAppearanceOpen, setIsKeyboardShortcutsOpen, setIsVisualizationModesOpen, setIsStreamingOpen,
    setIsStoragePersistenceOpen, setIsBetaOpen,
    setIsApiKeysOpen, setIsMapBoundsOpen, setIsSaveProjectOpen, setIsResourcesOpen, setIsGeomorphometryOpen,
  ]
  const allSettingsFolded = settingsSectionOpenStates.every((open) => !open)
  const handleFoldExpandAllSettings = () => {
    const next = allSettingsFolded
    settingsSectionSetters.forEach((setter) => setter(next))
  }
  // The theme-editor package has no built-in preset library (see README) — this
  // just hands its "Load Preset" picker off to the same setter ColorThemeSelect
  // uses. That flips this app's own data-theme attribute, which the editor's
  // MutationObserver (useThemeEditor.ts) already watches and re-snapshots from,
  // so no extra plumbing is needed on the editor's side.
  const handleLoadPreset = useCallback((name: string) => setColorTheme(name), [setColorTheme])
  // Auto-suffixes if the name collides with a BUILT-IN preset — otherwise two
  // [data-theme="cyberpunk-light"] rules (the real preset's + a same-named
  // custom save) would exist at once, and Radix Select would have two items
  // sharing one value. Saving over an EXISTING custom theme under the same
  // name is still a normal upsert (that's the "update" path), just never a
  // built-in one.
  const handleSaveTheme = useCallback((name: string, css: string) => {
    const isBuiltInCollision = sortedThemes.some((t) => t.name === name)
    const safeName = isBuiltInCollision ? `${name}-custom` : name
    const safeCss = isBuiltInCollision
      ? css.split(`"${name}-light"`).join(`"${safeName}-light"`).split(`"${name}-dark"`).join(`"${safeName}-dark"`)
      : css
    setCustomThemes((prev) => [...prev.filter((t) => t.name !== safeName), { name: safeName, css: safeCss }])
  }, [setCustomThemes])
  // The theme-editor package has no way to see this app's own light/dark
  // toggle, so Randomize's coin-flipped mode is synced back here. Sets the
  // ABSOLUTE target rather than comparing against `theme` and conditionally
  // toggling — rapid repeated calls (e.g. mashing the dice button) fire
  // faster than React re-renders, so a comparison against the `theme`
  // closure can read a stale value and desync from what was actually just
  // randomized; an idempotent direct set can't drift regardless of timing.
  const handleModeChange = useCallback((isDark: boolean) => {
    setAppTheme(isDark ? "dark" : "light")
  }, [setAppTheme])
  // const theme = state.theme
  // const setTheme = useCallback((v: string) => setState({theme: v}), [setState])
  // const toggleTheme = useCallback(() => setTheme(theme === "light" ? "dark" : "light"), [theme, setTheme])
  
  const [mapboxKey, setMapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey, setMaptilerKey] = useAtom(maptilerKeyAtom)
  const [hereKey, setHereKey] = useAtom(hereKeyAtom)
  const [planetKey, setPlanetKey] = useAtom(planetKeyAtom)
  const [googleKey, setGoogleKey] = useAtom(googleKeyAtom)
  const [titilerEndpoint, setTitilerEndpoint] = useAtom(titilerEndpointAtom)
  const [apiKeysViewMode, setApiKeysViewMode] = useState<"individual" | "batch">("individual")
  const [batchApiKeys, setBatchApiKeys] = useState("")
  const [useCogProtocolVsTitiler, setUseCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)
  const [isTransparentUi, setTransparentUi] = useAtom(transparentUiAtom)
  const [highResTerrain, setHighResTerrain] = useAtom(highResTerrainAtom)
  const [useClientExport, setUseClientExport] = useAtom(useClientExportAtom)
  const [cacheVizTiles, setCacheVizTiles] = useAtom(cacheVizTilesAtom)
  const [persistLocalCogs, setPersistLocalCogs] = useAtom(persistLocalCogsAtom)
  const [persistVectorLayers, setPersistVectorLayers] = useAtom(persistVectorLayersAtom)
  const opfsSupported = isOpfsSupported()
  const [opfsSummary, setOpfsSummary] = useState<{ count: number; bytes: number; quotaBytes: number | null } | null>(null)
  const [opfsVectorSummary, setOpfsVectorSummary] = useState<{ count: number; bytes: number; quotaBytes: number | null } | null>(null)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [projectId, setProjectId] = useState("")
  const [projectName, setProjectName] = useState("")
  const [projectCopied, setProjectCopied] = useState(false)

  // Which changelog screenshot/gif is currently blown up in the lightbox
  // dialog (see changelogMarkdownComponents' `img` renderer above) — null
  // means the lightbox is closed.
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt?: string } | null>(null)
  const handleChangelogImageClick = useCallback((src: string, alt?: string) => setLightboxImage({ src, alt }), [])
  // Deliberately NOT a nested Base UI <Dialog> (which is what this used to
  // be) — nesting one modal Dialog inside another already-open one broke
  // Base UI's own outside-press dismissal (DialogRoot's `outsidePress` only
  // accepts a click as "outside" while a dialog is the topmost one AND the
  // click lands exactly on ITS OWN tracked backdrop element; confirmed via
  // Escape, gated by that same isTopmost check, closing the lightbox fine
  // while a real backdrop click did not), and worse, once that WAS forced to
  // work via a manual click-outside handler here, the exact same click event
  // then fell through the closing lightbox to the Settings dialog's OWN
  // Base UI dismiss listener too (mousedown/click firing after pointerdown
  // has already unmounted the lightbox makes Settings look "topmost" again
  // mid-gesture), closing BOTH. A plain self-contained overlay with its own
  // Escape/outside-click handling sidesteps that whole cascade.
  const lightboxContentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!lightboxImage) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Capture phase + stopPropagation — this custom overlay never tells
      // the Settings dialog's Base UI DialogRoot it has a nested dialog open
      // (there's no such registration for a plain portal), so Settings
      // always considers itself topmost and its OWN Escape handling (bubble
      // phase) would otherwise also fire on the same keydown and close it.
      e.stopPropagation()
      setLightboxImage(null)
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [lightboxImage])
  const handleLightboxOverlayClick = useCallback((e: React.MouseEvent) => {
    if (lightboxContentRef.current && !lightboxContentRef.current.contains(e.target as Node)) {
      setLightboxImage(null)
    }
  }, [])

  const [lastSeenChangelogAt, setLastSeenChangelogAt] = useAtom(lastSeenChangelogAtAtom)
  const isWhatsNewSectionOpen = useAtomValue(isSettingsWhatsNewOpenAtom)
  // Frozen at first render, before either effect below can overwrite the atom —
  // so the "N new"/highlighted-entries list stays stable for this whole
  // component lifetime even once opening the dialog marks everything seen
  // for *next* time.
  const [unseenSinceSnapshot] = useState(lastSeenChangelogAt)
  const unseenChangelogEntries = useMemo(() => (
    // Plain ISO-string comparison — robust to CHANGELOG.md entries being
    // retitled (unlike comparing by heading text) and to reordering, since it
    // doesn't rely on array position at all.
    CHANGELOG_ENTRIES.filter((e) => e.releasedAt > unseenSinceSnapshot)
  ), [unseenSinceSnapshot])
  const hasUnseenChangelog = unseenChangelogEntries.length > 0
  const [changelogView, setChangelogView] = useAtom(changelogViewAtom)
  const [changelogEntriesOpen, setChangelogEntriesOpen] = useAtom(changelogEntriesOpenAtom)
  const visibleChangelogEntries = changelogView === "changes" ? unseenChangelogEntries : CHANGELOG_ENTRIES
  const allChangelogEntriesFolded = visibleChangelogEntries.length > 0 && visibleChangelogEntries.every((e) => changelogEntriesOpen[e.releasedAt] === false)
  const handleFoldExpandAllChangelog = useCallback(() => {
    const next = allChangelogEntriesFolded // currently all folded -> expand; otherwise -> fold
    setChangelogEntriesOpen((prev) => {
      const updated = { ...prev }
      visibleChangelogEntries.forEach((e) => { updated[e.releasedAt] = next })
      return updated
    })
  }, [allChangelogEntriesFolded, visibleChangelogEntries, setChangelogEntriesOpen])

  // Only once the What's New section is actually open (not merely because
  // Settings itself is open for something unrelated, like API keys) does it
  // clear the badge for next time, same as Discord/Slack.
  useEffect(() => {
    if (isOpen && isWhatsNewSectionOpen) setLastSeenChangelogAt(LATEST_CHANGELOG_RELEASED_AT)
  }, [isOpen, isWhatsNewSectionOpen])

  // Excluded from initialState: `project` itself (avoid self-reference) and
  // terrainUrl/basemapUrl (the *other* embed mechanism — redundant/conflicting
  // with a project preset, which seeds full custom-source objects instead).
  const EXCLUDED_STATE_KEYS = ["project", "terrainUrl", "basemapUrl"]

  const handleCopyProjectJson = useCallback(() => {
    const initialState: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(state)) {
      if (!EXCLUDED_STATE_KEYS.includes(key)) initialState[key] = value
    }

    // Any referenced source that isn't a builtin needs to travel WITH the preset —
    // a fresh visitor's browser has never seen it, so pull it out of the current
    // customTerrainSources/customBasemapSources lists by id.
    // Every view slot (A-H), not just A/B — a 2x2/3x1/3x2/4x2 grid can
    // reference a custom source from any of them.
    const referencedTerrainIds = [state.sourceA, state.sourceB, state.sourceC, state.sourceD, state.sourceE, state.sourceF, state.sourceG, state.sourceH].filter(Boolean)
    const referencedBasemapIds = [
      state.basemapSource, state.basemapSourceA, state.basemapSourceB, state.basemapSourceC, state.basemapSourceD, state.basemapSourceE, state.basemapSourceF, state.basemapSourceG, state.basemapSourceH,
      ...(state.overlayBasemapIds || []),
    ].filter(Boolean)
    const usedTerrainSources = customTerrainSources.filter((s) => referencedTerrainIds.includes(s.id))
    const usedBasemapSources = customBasemapSources.filter((s) => referencedBasemapIds.includes(s.id))

    const config: Record<string, unknown> = {
      id: projectId || "my-project",
      name: projectName || "My Project",
      initialState,
    }
    if (usedTerrainSources.length) config.customTerrainSources = usedTerrainSources
    if (usedBasemapSources.length) config.customBasemapSources = usedBasemapSources

    const snippet = JSON.stringify({ [projectId || "my-project"]: config }, null, 2)
    navigator.clipboard.writeText(snippet)
    setProjectCopied(true)
    setTimeout(() => setProjectCopied(false), 2000)
  }, [state, projectId, projectName, customTerrainSources, customBasemapSources])

  const refreshOpfsSummary = useCallback(async () => {
    if (!opfsSupported) return
    const [entries, estimate] = await Promise.all([listPersistedCogs(), estimateStorage()])
    setOpfsSummary({
      count: entries.length,
      bytes: entries.reduce((sum, e) => sum + e.size, 0),
      quotaBytes: estimate.quotaBytes,
    })
  }, [opfsSupported])

  const refreshOpfsVectorSummary = useCallback(async () => {
    if (!opfsSupported) return
    const [entries, estimate] = await Promise.all([listPersistedVectorLayers(), estimateStorage()])
    setOpfsVectorSummary({
      count: entries.length,
      bytes: entries.reduce((sum, e) => sum + e.size, 0),
      quotaBytes: estimate.quotaBytes,
    })
  }, [opfsSupported])

  // Refresh whenever the dialog opens — cheap, and the persisted set can
  // change any time a local COG or drawn/imported vector layer is added/
  // deleted elsewhere in the sidebar.
  useEffect(() => {
    if (isOpen) {
      refreshOpfsSummary()
      refreshOpfsVectorSummary()
    }
  }, [isOpen, refreshOpfsSummary, refreshOpfsVectorSummary])

  const handleClearPersistedCogs = useCallback(async () => {
    await clearAllPersistedCogs()
    refreshOpfsSummary()
  }, [refreshOpfsSummary])

  const handleClearPersistedVectorLayers = useCallback(async () => {
    await clearAllPersistedVectorLayers()
    refreshOpfsVectorSummary()
  }, [refreshOpfsVectorSummary])

  // Names match each var's VITE_-prefixed .env counterpart exactly (see .env) —
  // so a key=value block can be copy-pasted either direction just by adding or
  // stripping "VITE_", rather than needing a mental mapping between the two.
  // A plain view-mode toggle (not a modal edit flow), so every switch commits
  // immediately in whichever direction it's headed — into batch mode snapshots
  // the current individual values into the textarea, out of it parses the
  // textarea back into them. There's deliberately no "Cancel": switching away
  // from Batch always commits whatever text is currently there.
  const handleApiKeysViewModeChange = useCallback((mode: "individual" | "batch") => {
    if (mode === "batch") {
      setBatchApiKeys([`MAPBOX_ACCESS_TOKEN=${mapboxKey}`, `MAPTILER_API_KEY=${maptilerKey}`, `HERE_API_KEY=${hereKey}`, `PLANET_API_KEY=${planetKey}`, `GOOGLE_API_KEY=${googleKey}`].join("\n"))
    } else {
      batchApiKeys.split("\n").forEach((line) => {
        const [key, value] = line.split("=")
        if (key && value) {
          if (key.trim() === "MAPBOX_ACCESS_TOKEN") setMapboxKey(value.trim())
          if (key.trim() === "MAPTILER_API_KEY") setMaptilerKey(value.trim())
          if (key.trim() === "HERE_API_KEY") setHereKey(value.trim())
          if (key.trim() === "PLANET_API_KEY") setPlanetKey(value.trim())
          if (key.trim() === "GOOGLE_API_KEY") setGoogleKey(value.trim())
        }
      })
    }
    setApiKeysViewMode(mode)
  }, [batchApiKeys, mapboxKey, googleKey, maptilerKey, hereKey, planetKey, setMapboxKey, setGoogleKey, setMaptilerKey, setHereKey, setPlanetKey])

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open, eventDetails) => {
        // The advanced theme editor is portaled to <body> as a sibling of this
        // dialog (not inside its content), so a click inside it counts as
        // "outside" and Base UI would dismiss the Settings dialog. Keep the
        // dialog open when the interaction originates within the editor panel
        // (.tec-panel).
        if (!open && eventDetails.reason === "outside-press") {
          const target = (eventDetails.event as Event | undefined)?.target as HTMLElement | null
          if (target?.closest?.(".tec-panel")) {
            eventDetails.cancel()
            return
          }
        }
        onOpenChange(open)
      }}
    >
      <div className="relative inline-block">
        <DialogTrigger
          render={
            <TooltipIconButton
              id="tour-settings-button"
              icon={Settings}
              tooltip="Settings"
            />
          }
        />
        {hasUnseenChangelog && (
          <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-primary pointer-events-none" />
        )}
      </div>

      <DialogContent
        className="sm:max-w-2xl max-h-[80vh] overflow-y-auto"
        showCloseButton={false}
      >
        <div className="absolute top-4 right-4 flex items-center gap-1">
          <TooltipIconButton
            icon={Compass}
            tooltip="Take the tour"
            onClick={() => { onOpenChange(false); setIsTourOpen(true) }}
          />
          <TooltipIconButton
            icon={BookOpen}
            tooltip="Open Documentation"
            // Relative (not "/docs/") so this resolves correctly whichever
            // domain/subpath the app itself is currently served from — see
            // vite.config.ts's own `base: "./"` and docs/next.config.mjs's
            // matching `basePath: "/docs"` (the docs app's static export is
            // copied into dist/docs alongside the app by the GH Pages
            // workflow; in dev, vite.config.ts's own /docs proxy forwards
            // here to the docs app's separate dev server instead).
            onClick={() => window.open("docs/", "_blank", "noopener,noreferrer")}
          />
          <TooltipIconButton
            icon={allSettingsFolded ? ChevronsUpDown : ChevronsDownUp}
            tooltip={allSettingsFolded ? "Expand all sections" : "Fold all sections"}
            onClick={handleFoldExpandAllSettings}
          />
          <DialogClose className="cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
        </div>
        <DialogHeader>
          <DialogTitle>Settings & Resources</DialogTitle>
          <DialogDescription>Configure API keys, application settings, and explore related resources</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <CollapsibleSection
            title="What's New - Changelog"
            openAtom={isSettingsWhatsNewOpenAtom}
            contentClassName="space-y-3 pt-2"
            headerExtra={
              <div className="flex items-center gap-3">
                {hasUnseenChangelog && (
                  <span className="flex items-center gap-1 text-xs font-medium text-primary-foreground bg-primary rounded-full px-2 py-0.5">
                    <Sparkles className="h-3 w-3" /> {unseenChangelogEntries.length} new
                  </span>
                )}
                <TooltipIconButton
                  icon={allChangelogEntriesFolded ? ChevronsUpDown : ChevronsDownUp}
                  tooltip={allChangelogEntriesFolded ? "Expand all entries" : "Fold all entries"}
                  onClick={handleFoldExpandAllChangelog}
                  disabled={visibleChangelogEntries.length === 0}
                />
                <div className="flex items-center gap-2 cursor-pointer">
                  <Label htmlFor="changelog-view" className="text-xs text-muted-foreground cursor-pointer">Changes</Label>
                  <Switch
                    id="changelog-view"
                    checked={changelogView === "full"}
                    onCheckedChange={(checked) => setChangelogView(checked ? "full" : "changes")}
                    className="h-5 w-9 bg-muted data-checked:bg-primary rounded-full p-1 cursor-pointer border-transparent"
                  />
                  <Label htmlFor="changelog-view" className="text-xs text-muted-foreground cursor-pointer">Full</Label>
                </div>
              </div>
            }
          >
            {changelogView === "changes" ? (
              hasUnseenChangelog ? (
                <ChangelogEntryList entries={unseenChangelogEntries} onImageClick={handleChangelogImageClick} />
              ) : (
                <p className="text-xs text-muted-foreground">You&apos;re all caught up.</p>
              )
            ) : (
              <div className="max-h-96 overflow-y-auto pr-1">
                <ChangelogEntryList entries={CHANGELOG_ENTRIES} onImageClick={handleChangelogImageClick} />
              </div>
            )}
          </CollapsibleSection>
          <Separator />
          <CollapsibleSection title="Appearance" openAtom={isSettingsAppearanceOpenAtom}>
            <div className="flex items-center justify-between">
              <Label>Theme</Label>
              <Button variant="outline" size="sm" onClick={toggleTheme} className="cursor-pointer">
                {theme === "light" ? <><Moon className="h-4 w-4 mr-2" />Dark</> : <><Sun className="h-4 w-4 mr-2" />Light</>}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <Label htmlFor="transparent-ui">Transparent UI</Label>
                <span className="text-sm text-muted-foreground">
                  Useful for editing symbology on mobile
                </span>
              </div>

              <Switch
                id="transparent-ui"
                checked={isTransparentUi}
                className="cursor-pointer"
                onCheckedChange={setTransparentUi}
              />
            </div>
            {/* Color Theme — a sub-section of Appearance (light/dark lives right
                above it here). */}
            <div className="pt-1 space-y-2">
              <div className="flex items-baseline gap-2">
              <Label className="text-sm font-medium">Color Theme</Label>
              <p className="text-xs text-muted-foreground">
                Preset UI color palette/font/radius (<a href="https://tweakcn.com/" target="_blank" rel="noopener noreferrer" className="underline">tweakcn</a>, <a href="https://themux.vercel.app/shadcn-themes" target="_blank" rel="noopener noreferrer" className="underline">themux</a>, <a href="https://shadcnstudio.com/" target="_blank" rel="noopener noreferrer" className="underline">shadcnstudio</a>)
              </p>
              </div>
              <div className="flex gap-2">
                <div className="flex-[2] min-w-0">
                  <ColorThemeSelect />
                </div>
                <Button variant="outline" size="sm" className="flex-1 min-w-0 cursor-pointer" onClick={() => setShowThemeEditor(true)}>
                  Advanced Theme Editor
                </Button>
              </div>
            </div>
          </CollapsibleSection>
          <Separator />
          <CollapsibleSection title="Keyboard Shortcuts" openAtom={isSettingsKeyboardShortcutsOpenAtom} contentClassName="space-y-2 pt-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={KEYBOARD_SHORTCUTS_MARKDOWN_COMPONENTS}>
              {KEYBOARD_SHORTCUTS_MARKDOWN}
            </ReactMarkdown>
          </CollapsibleSection>
          <Separator />

          {!historicalMode && (
          <>
          <CollapsibleSection title="Visualization Modes" openAtom={isSettingsVisualizationModesOpenAtom} contentClassName="space-y-2 pt-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={VIZ_MODES_DESCRIPTION_MARKDOWN_COMPONENTS}>
              {VISUALIZATION_MODES_DESCRIPTION_MARKDOWN}
            </ReactMarkdown>
          </CollapsibleSection>
          <Separator />
          </>
          )}

          <CollapsibleSection title="Streaming Settings" openAtom={isSettingsStreamingOpenAtom} contentClassName="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">COG Streaming Settings</Label>
              <SegmentedToggle
                className="w-[160px]"
                value={useCogProtocolVsTitiler ? "cogprotocol" : "titiler"}
                onChange={(value) => setUseCogProtocolVsTitiler(value === "cogprotocol")}
                options={[
                  { value: "cogprotocol", label: "MapLibre" },
                  { value: "titiler", label: "Titiler" },
                ]}
              />
            </div>

            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
              <p className="mb-1">
                <span className="font-semibold">MapLibre COG Protocol from Geomatico:</span> Direct COG client consumption.
                Faster and avoids overflooding Titiler, but may encounter CORS errors.
              </p>
              <p>
                <span className="font-semibold">Titiler:</span> Middleware service that fetches remote COG
                and streams TMS tiles.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="use-client-export">DTM Export without Titiler</Label>
                <span className="text-xs text-muted-foreground">
                  Browser range-reads and mosaics tiles/COGs directly, bypassing Titiler's server-side size limit
                </span>
              </div>
              <Switch
                id="use-client-export"
                checked={useClientExport}
                className="cursor-pointer"
                onCheckedChange={setUseClientExport}
              />
            </div>

            {!historicalMode && useCogProtocolVsTitiler && (
              <div className="flex items-center justify-between pt-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="high-res-terrain">High-Precision Elevation Quantization </Label>
                  <span className="text-xs text-muted-foreground">
                    Slower Streaming, Higher quantization steps (3.9mm vs 10cm) for COGs via Terrarium (vs TerrainRGB)
                  </span>
                </div>
                <Switch
                  id="high-res-terrain"
                  checked={highResTerrain}
                  className="cursor-pointer"
                  onCheckedChange={setHighResTerrain}
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="cache-viz-tiles">Cache Computed Viz-Mode Tiles</Label>
                <span className="text-xs text-muted-foreground">
                  Keeps finished Slope-and-More / detector tiles in memory (up to ~96MB) so re-toggling a mode is instant instead of recomputing
                </span>
              </div>
              <Switch
                id="cache-viz-tiles"
                checked={cacheVizTiles}
                className="cursor-pointer"
                onCheckedChange={setCacheVizTiles}
              />
            </div>
              
            <div className="flex gap-2">
              <Label className="flex-1 min-w-0" htmlFor="titiler-endpoint">Titiler Endpoint</Label>
              <Input className="flex-2 min-w-0 cursor-text" id="titiler-endpoint" type="text" placeholder="https://titiler.xyz" value={titilerEndpoint} onChange={(e) => setTitilerEndpoint(e.target.value)} />
            </div>
          </CollapsibleSection>


          <Separator />
          <CollapsibleSection title="Browser Local Storage Persistence" openAtom={isSettingsStoragePersistenceOpenAtom} contentClassName="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Local COG Files</Label>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="persist-local-cogs" className="sr-only">Remember local COG files between sessions</Label>
                  <span className="text-xs text-muted-foreground">
                    {opfsSupported
                      ? "Remember local COG files between sessions — copies picked local COG files into this browser's private storage (OPFS) so you don't need to re-pick them after a reload."
                      : "Not supported in this browser — local COG files will always need re-picking after a reload."}
                  </span>
                </div>
                <Switch
                  id="persist-local-cogs"
                  checked={persistLocalCogs}
                  disabled={!opfsSupported}
                  className="cursor-pointer"
                  onCheckedChange={setPersistLocalCogs}
                />
              </div>
              {opfsSupported && opfsSummary && (
                <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                  <span>
                    {opfsSummary.count === 0
                      ? "No local COG files persisted yet"
                      : `${opfsSummary.count} file${opfsSummary.count === 1 ? "" : "s"} persisted — ${formatBytes(opfsSummary.bytes)}${opfsSummary.quotaBytes ? ` (browser storage quota for this site: ~${formatBytes(opfsSummary.quotaBytes)}, shared with everything else this site stores)` : ""}`}
                  </span>
                  {opfsSummary.count > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 p-4 cursor-pointer text-muted-foreground hover:bg-transparent hover:text-destructive border hover:border-destructive" onClick={handleClearPersistedCogs}>
                      <Trash2 className="h-3 w-3 mr-1" /> Clear
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Vector Layers (TerraDraw)</Label>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="persist-vector-layers" className="sr-only">Remember drawn/imported layers between sessions</Label>
                  <span className="text-xs text-muted-foreground">
                    {opfsSupported
                      ? "Remember drawn/imported layers between sessions — copies drawn and imported vector layers (Tools: Drawing) into this browser's private storage (OPFS) so they survive a reload."
                      : "Not supported in this browser — drawn/imported layers will always be lost on a reload."}
                  </span>
                </div>
                <Switch
                  id="persist-vector-layers"
                  checked={persistVectorLayers}
                  disabled={!opfsSupported}
                  className="cursor-pointer"
                  onCheckedChange={setPersistVectorLayers}
                />
              </div>
              {opfsSupported && opfsVectorSummary && (
                <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                  <span>
                    {opfsVectorSummary.count === 0
                      ? "No vector layers persisted yet"
                      : `${opfsVectorSummary.count} layer${opfsVectorSummary.count === 1 ? "" : "s"} persisted — ${formatBytes(opfsVectorSummary.bytes)}${opfsVectorSummary.quotaBytes ? ` (browser storage quota for this site: ~${formatBytes(opfsVectorSummary.quotaBytes)}, shared with everything else this site stores)` : ""}`}
                  </span>
                  {opfsVectorSummary.count > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 p-4 cursor-pointer text-muted-foreground hover:bg-transparent hover:text-destructive border hover:border-destructive" onClick={handleClearPersistedVectorLayers}>
                      <Trash2 className="h-3 w-3 mr-1" /> Clear
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CollapsibleSection>

          <Separator />
          <CollapsibleSection title="Beta" openAtom={isSettingsBetaOpenAtom} contentClassName="space-y-4 pt-2">
            {!historicalMode && (
            <>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Tells (Mound Candidates) Detection</h4>
                <div className="flex items-center gap-2">
                  <Label htmlFor="tells-beta" className="text-xs font-normal text-muted-foreground">Beta</Label>
                  <Switch
                    id="tells-beta"
                    checked={state.tellsBeta}
                    className="cursor-pointer"
                    onCheckedChange={(checked) => setState({ tellsBeta: checked })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Computes a <span className="font-semibold text-foreground">Difference-of-Gaussians of the LRM</span>{" "}
                (DoG-of-LRM) as the primary bump signal, keeps only its local maxima
                (non-maximum suppression scaled to the configured tell size), then vetoes
                candidates that fail any of three shape filters: <span className="font-semibold text-foreground">Blobness</span>{" "}
                (structure-tensor peak/pit detector), <span className="font-semibold text-foreground">Plan Curvature / Divergence</span>{" "}
                (rejects saddles and ridges where flow diverges outward across contours), and{" "}
                <span className="font-semibold text-foreground">Det-Hessian</span> (rejects saddle points, keeps bowl/dome shapes).
              </p>
            </div>

            <Separator />
            </>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Sun Shadow Calculator</h4>
                <div className="flex items-center gap-2">
                  <Label htmlFor="sun-shadow-beta" className="text-xs font-normal text-muted-foreground">Beta</Label>
                  <Switch
                    id="sun-shadow-beta"
                    checked={state.sunShadowBeta}
                    className="cursor-pointer"
                    onCheckedChange={(checked) => setState({ sunShadowBeta: checked })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Pick a point on the map and measure the shadow an object of a given
                height casts at the current sun position/date/time (Tools section)
                — reuses the shared date/time light direction control that
                Hillshade/Phong/Shadows also drive.
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Historical Imagery Sources</h4>
                <div className="flex items-center gap-2">
                  <Label htmlFor="historical-beta" className="text-xs font-normal text-muted-foreground">Beta</Label>
                  <Switch
                    id="historical-beta"
                    checked={state.historicalBeta}
                    className="cursor-pointer"
                    onCheckedChange={(checked) => setState({ historicalBeta: checked })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Adds <span className="font-semibold text-foreground">ESRI Wayback, HLS (Landsat/Sentinel), Google Earth Historical, and Planet Monthly Mosaic</span>{" "}
                as basemap options plus a bottom timeline scrubber for picking a capture
                date per source (Basemap section).
              </p>
            </div>
          </CollapsibleSection>

          <Separator />
          <CollapsibleSection
            title="API Keys"
            openAtom={isSettingsApiKeysOpenAtom}
            contentClassName="space-y-4 pt-2"
            headerExtra={
              <div className="flex items-center gap-2 cursor-pointer">
                <Label htmlFor="api-keys-view" className="text-xs text-muted-foreground cursor-pointer">One per key</Label>
                <Switch
                  id="api-keys-view"
                  checked={apiKeysViewMode === "batch"}
                  onCheckedChange={(checked) => handleApiKeysViewModeChange(checked ? "batch" : "individual")}
                  className="h-5 w-9 bg-muted data-checked:bg-primary rounded-full p-1 cursor-pointer border-transparent"
                />
                <Label htmlFor="api-keys-view" className="text-xs text-muted-foreground cursor-pointer">Batch</Label>
              </div>
            }
          >
            {apiKeysViewMode === "batch" ? (
              <div className="space-y-2">
                <Label htmlFor="batch-keys">API Keys (one per line: key=value)</Label>
                <JsonEditor
                  language="properties"
                  value={batchApiKeys}
                  onChange={setBatchApiKeys}
                  rows={5}
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="mapbox-key">Mapbox Access Token</Label>
                  <PasswordInput
                    id="mapbox-key"
                    value={mapboxKey}
                    onChange={(e: any) => setMapboxKey(e.target.value)}
                    className="cursor-text"
                  />
                </div>

                {/* MapTiler is the one key here used only by a terrain (DEM)
                    source, never a basemap — Mapbox/HERE/Planet/Google below
                    are all needed for basemap options too (some of them
                    specifically FOR historical basemaps), so they stay. */}
                {!historicalMode && (
                <div className="space-y-2">
                  <Label htmlFor="maptiler-key">MapTiler API Key</Label>
                  <PasswordInput
                    id="maptiler-key"
                    value={maptilerKey}
                    onChange={(e: any) => setMaptilerKey(e.target.value)}
                    className="cursor-text"
                  />
                </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="here-key">HERE Maps API Key</Label>
                  <PasswordInput
                    id="here-key"
                    value={hereKey}
                    onChange={(e: any) => setHereKey(e.target.value)}
                    className="cursor-text"
                  />
                  <p className="text-xs text-muted-foreground">
                    Unlocks HERE Satellite as a Basemap option — hidden until set.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="planet-key">Planet API Key</Label>
                  <PasswordInput
                    id="planet-key"
                    value={planetKey}
                    onChange={(e: any) => setPlanetKey(e.target.value)}
                    className="cursor-text"
                  />
                  <p className="text-xs text-muted-foreground">
                    Unlocks Planet Monthly Mosaics as a historical Basemap option — hidden until set.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="google-key">Google Maps API Key</Label>
                  <PasswordInput
                    id="google-key"
                    value={googleKey}
                    onChange={(e: any) => setGoogleKey(e.target.value)}
                    className="cursor-text"
                  />
                </div>
              </>
            )}
          </CollapsibleSection>
          <Separator />
          <CollapsibleSection title="Map bounds constraints" openAtom={isSettingsMapBoundsOpenAtom}>
            <p className="text-xs text-muted-foreground">
              Constrains panning/zooming to a bounding box. "Terrain"/"Raster"/"Union" are
              resolved automatically from the active source(s) (COG/tilejson metadata) and
              update if you switch sources.
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Smart bounds zoom:</span> clicking a
              source's name (Terrain Source / Basemap Source lists) only flies to its bounds when
              they're fully inside the current viewport or fully disjoint from it — a world-covering
              basemap or a partially-overlapping COG preserves your camera viewport instead of
              yanking your context away.
            </p>
            <div className="space-y-1">
              <Label>Mode</Label>
              <Select
                value={state.maxBoundsMode}
                onValueChange={(value) => setState({ maxBoundsMode: value as MaxBoundsMode })}
                items={{
                  none: "None",
                  terrain: "Terrain Source Bounds",
                  raster: "Raster Basemap Bounds",
                  union: "Union (Terrain + Raster)",
                  custom: "Custom (WSNE)",
                }}
              >
                <SelectTrigger className="w-full cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_BOUNDS_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {{
                        none: "None",
                        terrain: "Terrain Source Bounds",
                        raster: "Raster Basemap Bounds",
                        union: "Union (Terrain + Raster)",
                        custom: "Custom (WSNE)",
                      }[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {state.maxBoundsMode !== "none" && (
              <div className="space-y-1">
                <Label htmlFor="max-bounds-buffer">Buffer (degrees)</Label>
                <Input
                  id="max-bounds-buffer"
                  type="number"
                  step="0.01"
                  min="0"
                  value={state.maxBoundsBuffer}
                  onChange={(e) => setState({ maxBoundsBuffer: Number.parseFloat(e.target.value) || 0 })}
                  className="cursor-text"
                />
              </div>
            )}
            {state.maxBoundsMode === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="max-bounds-west">West</Label>
                  <Input id="max-bounds-west" type="number" value={state.maxBoundsWest} onChange={(e) => setState({ maxBoundsWest: Number.parseFloat(e.target.value) || 0 })} className="cursor-text" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="max-bounds-south">South</Label>
                  <Input id="max-bounds-south" type="number" value={state.maxBoundsSouth} onChange={(e) => setState({ maxBoundsSouth: Number.parseFloat(e.target.value) || 0 })} className="cursor-text" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="max-bounds-east">East</Label>
                  <Input id="max-bounds-east" type="number" value={state.maxBoundsEast} onChange={(e) => setState({ maxBoundsEast: Number.parseFloat(e.target.value) || 0 })} className="cursor-text" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="max-bounds-north">North</Label>
                  <Input id="max-bounds-north" type="number" value={state.maxBoundsNorth} onChange={(e) => setState({ maxBoundsNorth: Number.parseFloat(e.target.value) || 0 })} className="cursor-text" />
                </div>
              </div>
            )}
          </CollapsibleSection>
          <Separator />
          <CollapsibleSection title="Save Project Preset" openAtom={isSettingsSaveProjectOpenAtom}>
            <p className="text-xs text-muted-foreground">
              Copies the current view/sources/viz settings as a project-preset JSON snippet you can
              paste into lib/projects.json (as a new top-level key) to make it loadable via
              <code className="mx-1 bg-muted px-1 rounded">?project=your-id</code>.
            </p>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="project-id">Project ID</Label>
                <Input id="project-id" type="text" placeholder="my-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="cursor-text" />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="project-name">Project Name</Label>
                <Input id="project-name" type="text" placeholder="My Project" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="cursor-text" />
              </div>
            </div>
            <Button onClick={handleCopyProjectJson} className="cursor-pointer w-full" variant="outline">
              {projectCopied ? "Copied!" : "Copy Project JSON"}
            </Button>
          </CollapsibleSection>
          <Separator />
          <CollapsibleSection title="Resources: MapLibre GL Features" openAtom={isSettingsResourcesOpenAtom}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={RESOURCE_LINKS_MARKDOWN_COMPONENTS}>
              {RESOURCES_MAPLIBRE_MARKDOWN}
            </ReactMarkdown>
          </CollapsibleSection>
          <Separator />
          <CollapsibleSection title="Resources: Topography, Geomorphometry, Hydrology Scientific Literature and Tools" openAtom={isSettingsGeomorphometryOpenAtom}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={RESOURCE_LINKS_MARKDOWN_COMPONENTS}>
              {RESOURCES_GEOMORPHOMETRY_MARKDOWN}
            </ReactMarkdown>
          </CollapsibleSection>

        </div>
      </DialogContent>

      {/* Changelog image lightbox — a plain portal-to-body overlay, not a
          nested Base UI Dialog (see the state/handlers above for why). Plain
          img at near-viewport size instead of a gallery/carousel: each
          screenshot/gif already sits next to its own caption in the TL;DR
          list it was clicked from, so there's no separate multi-image
          browsing need. */}
      {lightboxImage && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={handleLightboxOverlayClick}
        >
          <div ref={lightboxContentRef} className="rounded-lg overflow-hidden">
            <img
              src={lightboxImage.src}
              alt={lightboxImage.alt}
              // No w-full/h-full (that forced a fixed-box + letterbox layout
              // before) — width/height "auto" render the image at its native
              // size, only capped (never upscaled) by max-width/max-height,
              // so this box (sized to fit its own content) always hugs the
              // image with no bars.
              style={{ width: "auto", height: "auto", maxWidth: "90vw", maxHeight: "90vh" }}
              className="block"
            />
          </div>
        </div>,
        document.body,
      )}

      {showThemeEditor && (
        <ThemeEditorPanel
          onClose={() => setShowThemeEditor(false)}
          onSaveTheme={handleSaveTheme}
          onModeChange={handleModeChange}
          presetGroups={PRESET_GROUPS}
          onLoadPreset={handleLoadPreset}
        />
      )}
    </Dialog >
  )
}