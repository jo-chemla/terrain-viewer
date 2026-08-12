import type React from "react"
import { useState, useCallback, useEffect, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom, type PrimitiveAtom } from "jotai"
import { Moon, Sun, Settings, ExternalLink, Trash2, ChevronDown, ChevronsDownUp, ChevronsUpDown, Sparkles } from "lucide-react"
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
const CHANGELOG_MARKDOWN_COMPONENTS = {
  ul: ({ children }: any) => <ul className="list-disc pl-4 space-y-1.5 text-sm text-muted-foreground">{children}</ul>,
  strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
  code: ({ children }: any) => <code className="bg-muted px-1 rounded text-xs">{children}</code>,
  a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>,
  img: ({ src, alt }: any) => <img src={src} alt={alt} className="rounded border max-w-full my-2" />,
}

// Renders a list of changelog entries as heading + TL;DR-only markdown — used
// for both the "since you last looked" highlights and the "full changelog"
// view (settings-dialog.tsx never renders the dev-oriented Features/Bug Fixes
// prose from CHANGELOG.md).
const ChangelogEntryList: React.FC<{ entries: ChangelogEntry[] }> = ({ entries }) => {
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
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={CHANGELOG_MARKDOWN_COMPONENTS}>
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

  // Fold-all/expand-all for the settings dialog's own sections — same idea as
  // the sidebar's chevron button (TerrainControlPanel.tsx), just against N
  // separate atomWithStorage atoms here instead of one combined open-state
  // object, since each settings section persists independently.
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

  const [lastSeenChangelogAt, setLastSeenChangelogAt] = useAtom(lastSeenChangelogAtAtom)
  const isWhatsNewSectionOpen = useAtomValue(isSettingsWhatsNewOpenAtom)
  // Frozen at first render, before either effect below can overwrite the atom —
  // so the "N new"/highlighted-entries list stays stable for this whole
  // component lifetime even once opening the dialog marks everything seen
  // for *next* time.
  const [unseenSinceSnapshot] = useState(lastSeenChangelogAt)
  const unseenChangelogEntries = useMemo(() => {
    if (unseenSinceSnapshot === "") return [] // sentinel for "never seen any" — a brand-new visitor, not stale data
    // Plain ISO-string comparison — robust to CHANGELOG.md entries being
    // retitled (unlike comparing by heading text) and to reordering, since it
    // doesn't rely on array position at all.
    return CHANGELOG_ENTRIES.filter((e) => e.releasedAt > unseenSinceSnapshot)
  }, [unseenSinceSnapshot])
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

  // First-ever visit: silently mark caught-up so the badge never flashes for
  // someone who's never had anything to catch up on.
  useEffect(() => {
    if (unseenSinceSnapshot === "") setLastSeenChangelogAt(LATEST_CHANGELOG_RELEASED_AT)
  }, [])
  // Returning visitor: only once the What's New section is actually open (not
  // merely because Settings itself is open for something unrelated, like API
  // keys) does it clear the badge for next time, same as Discord/Slack.
  useEffect(() => {
    if (isOpen && isWhatsNewSectionOpen && unseenSinceSnapshot !== "") setLastSeenChangelogAt(LATEST_CHANGELOG_RELEASED_AT)
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
            title="What's New"
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
                <ChangelogEntryList entries={unseenChangelogEntries} />
              ) : (
                <p className="text-xs text-muted-foreground">You&apos;re all caught up.</p>
              )
            ) : (
              <div className="max-h-96 overflow-y-auto pr-1">
                <ChangelogEntryList entries={CHANGELOG_ENTRIES} />
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
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">Shift</kbd> <span className="mx-1">(tap alone, either side, Terrain mode only)</span> — toggle the Raster Basemap on/off, without opening the sidebar.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">Ctrl</kbd> <span className="mx-1">(tap alone, either side, Terrain mode only)</span> — hide every visualization mode down to just the plain basemap; tap again to restore whichever modes were on.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">Space</kbd> — re-toggle whichever visualization-mode checkbox you last clicked, even after a map drag has moved keyboard focus onto the map canvas.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">L</kbd> <span className="mx-1">(hold, Terrain mode only)</span> + drag — set the Hillshade illumination direction/altitude directly on the map instead of panning it; release L or the mouse to exit.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">Ctrl</kbd>+<kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">K</kbd> — jump focus to the search box (geocoder) from anywhere.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">←</kbd>/<kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">→</kbd> <span className="mx-1">(after editing a dropdown)</span> — cycle through that dropdown's options without reopening it.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">←</kbd>/<kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">→</kbd> <span className="mx-1">(Historical Timeline, after picking a date)</span> — step that view's picked date one mark at a time.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">Ctrl</kbd>+drag <span className="mx-1">(Historical Timeline handle)</span> — also sweeps every other handle on that same side along with it, by the same number of marks.</div>
            </div>
          </CollapsibleSection>
          <Separator />

          {!historicalMode && (
          <>
          <CollapsibleSection title="Visualization Modes" openAtom={isSettingsVisualizationModesOpenAtom} contentClassName="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              Grouped as they are in the panel — <span className="font-semibold text-foreground">Terrain Analysis</span>{" "}
              (surface derivatives + neighborhood statistics), <span className="font-semibold text-foreground">Relief Visualization</span>{" "}
              (multi-scale relief / visibility) and <span className="font-semibold text-foreground">Light</span> (normal-based shading).
              Most are supported by — and inspired by — <span className="font-semibold text-foreground">gdaldem</span>{" "}
              and the <span className="font-semibold text-foreground">RVT (Relief Visualization Toolbox)</span> QGIS plugin.
            </p>

            <div className="pt-1 text-xs font-semibold text-foreground">Terrain Analysis</div>

            <div className="pt-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Surface derivatives</div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div><span className="font-semibold text-foreground">Slope:</span> magnitude of the gradient</div>
              <div><span className="font-semibold text-foreground">Aspect:</span> direction of the gradient</div>
              <div>
                <div><span className="font-semibold text-foreground">Curvature:</span> rate of slope change — Profile, Plan, Mean/Combined, Gaussian (Det Hessian), or Casorati</div>
                <ul className="list-disc pl-5 pt-1 space-y-1">
                  <li><span className="font-medium text-foreground">Profile (Flow Acceleration):</span> rate of slope change along the steepest-descent direction, affects flow acceleration</li>
                  <li><span className="font-medium text-foreground">Plan (Convergence/Divergence):</span> rate of aspect change across contours, affects flow convergence/divergence — equivalent to the divergence of the normalized gradient field, div(∇z/|∇z|)</li>
                  <li><span className="font-medium text-foreground">Mean/Combined:</span> discrete Laplacian (∇²z) — mean curvature H = (κ₁+κ₂)/2, general surface bending that doesn't separate flow direction from contour direction</li>
                  <li><span className="font-medium text-foreground">Gaussian Curvature (Det Hessian):</span> determinant of the Hessian (fxx·fyy − fxy²) — Gaussian curvature K = κ₁·κ₂, a blob/saddle detector, positive at bowl/dome-shaped extrema and negative at saddle points</li>
                  <li><span className="font-medium text-foreground">Casorati:</span> κ = √((κ₁²+κ₂²)/2) — RMS of the two principal curvatures (Koch, 1993); always ≥ 0, measures how curved the surface is regardless of shape (dome, ridge, saddle, valley and bowl all read the same), zero only on flat ground</li>
                </ul>
              </div>
            </div>

            <div className="pt-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Neighborhood statistics</div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div><span className="font-semibold text-foreground">TRI (Terrain Ruggedness Index):</span> mean elevation difference to neighbors</div>
              <div><span className="font-semibold text-foreground">TPI (Topographic Position Index):</span> elevation relative to neighborhood mean</div>
              <div><span className="font-semibold text-foreground">Roughness:</span> max−min elevation in a neighborhood</div>
              <div><span className="font-semibold text-foreground">Shape Index:</span> SI = (2/π)·atan2(κ₁+κ₂, κ₁−κ₂) — Koenderink &amp; van Doorn (1992); scale-free and bounded to [−1, 1] regardless of curvature magnitude: +1 dome/peak, +0.5 ridge, 0 saddle, −0.5 valley, −1 pit/bowl</div>
            </div>

            <div className="pt-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Principal Components (PCA)</div>
            <p className="text-xs text-muted-foreground">
              A local 2D PCA of the window's gradient vectors, via the Förstner/Harris structure tensor
              (box-averaged Ixx/Iyy/Ixy over a 5×5 window) — the same tensor behind all three modes below.
            </p>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div><span className="font-semibold text-foreground">Blobness:</span> det(J)/trace(J) — large where the gradient direction varies in every direction (peaks, pits, saddles, knolls), near zero on a uniform slope or straight ridge/valley; conflates shape with steepness</div>
              <div><span className="font-semibold text-foreground">Eigenvalue Ratio:</span> λmin/λmax of the structure tensor (0–100%) — shape only, independent of steepness: 0% is a coherent linear feature (slope/ridge/valley), 100% is an isotropic blob (peak/pit/saddle)</div>
              <div><span className="font-semibold text-foreground">Dominant Orientation:</span> axis (0–180°) of the tensor's dominant eigenvector — which way a linear feature (ridge, valley, fault line) runs; most meaningful where Eigenvalue Ratio is low</div>
            </div>

            <div className="pt-2 text-xs font-semibold text-foreground">Relief Visualization</div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div><span className="font-semibold text-foreground">LRM (Local Relief Model):</span> raw elevation minus a low-pass-filtered version, isolating small features from large-scale topography — the low-pass mean is bilinearly interpolated from a lower-resolution tile further up the pyramid tree. Conceptually close to <span className="font-medium text-foreground">HAG (Height Above Ground)</span>, but with the "ground" being that smoothed local trend surface rather than a classified bare-earth model.</div>
              <div><span className="font-semibold text-foreground">SVF (Sky-View Factor):</span> the fraction of the sky hemisphere visible from a point (0–1), estimated from horizon angles sampled in many directions — darkens enclosed valleys and pits, brightens exposed ridges and summits, independent of any light direction</div>
              <div><span className="font-semibold text-foreground">Openness (Positive / Negative):</span> the mean zenith (positive) or nadir (negative) horizon angle over a search radius — positive openness emphasizes convex, exposed features (ridges, crests), negative openness emphasizes concave ones (channels, pits); a diffuse, illumination-free relief</div>
              <div><span className="font-semibold text-foreground">Local Dominance:</span> how much a location visually towers over its surroundings — the mean angular drop to the terrain around it across a radius range, highlighting locally elevated features such as mounds, plateaus and terraces</div>
            </div>

            <div className="pt-2 text-xs font-semibold text-foreground">Light</div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div><span className="font-semibold text-foreground">Matcap (material capture):</span> looks up a surface colour from a pre-lit sphere image using the surface normal as UV coordinates — a stylized, art-directable shading that doesn't depend on a directional light</div>
              <div><span className="font-semibold text-foreground">Phong:</span> real ambient + diffuse + specular shading from a compass-fixed (or camera-relative) light direction — a physically-plausible 3D-relief render; "3D Slow" drapes over terrain/globe via raster tiles, "2D Fast" is a live GPU shader (see the Lighting Effects panel)</div>
              <div><span className="font-semibold text-foreground">Shadows:</span> hard cast shadows — darkens a pixel wherever nearby terrain rises above the sun's own angle in the sky, blocking direct light (a single-ray horizon-angle march toward the sun's azimuth); shares Phong/Hillshade's light direction, no separate control of its own beyond opacity and search radius</div>
              <div className="pt-1 italic">Neighborhood usually refers to a 3×3 kernel centered on the pixel.</div>
            </div>

            <div className="pt-2 text-xs font-semibold text-foreground">Terrain Encoding Functions</div>
            <div className="space-y-2 text-sm font-mono bg-muted p-3 rounded">
              <div><span className="font-semibold">TerrainRGB:</span><br /><code>height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)</code></div>
              <div className="mt-2"><span className="font-semibold">Terrarium:</span><br /><code>height = (R * 256 + G + B / 256) - 32768</code></div>
            </div>
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
            <div className="space-y-2 text-sm">

                <a href="https://github.com/maplibre/maplibre-style-spec/issues/1374" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>New Normal-Derived Methods like slope, aspect etc (Design Proposal #1374)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://github.com/maplibre/maplibre-gl-js/pull/5768" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>Additional Hillshade Methods (combined, igor, multidir, PR #5768)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://github.com/maplibre/maplibre-gl-js/pull/5913" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>Hypsometric Tint color-relief (PR #5913)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://github.com/maplibre/maplibre-style-spec/issues/583#issuecomment-2028639772" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>Contour Lines and onthegomap/maplibre-contour plugin (Issue #583)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://labs.geomatico.es/maplibre-cog-protocol-examples/#/en/pirineo" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>Geomatico COG Protocol for Maplibre</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://github.com/maplibre/maplibre-gl-js/discussions/3378" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>3D Tiles early Discussion (#3378)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://github.com/dzfranklin/plantopo/issues/258" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>PlanTopo slope-server — custom maplibre protocol inspiration</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://www.npmjs.com/package/cpt2js" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>Color-ramps (Topo, topobath etc) distributed from cpt2js Package</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://rfspace.com/RFSPACE/SpectraFlux/colormaps/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>RFSpace/SpectraFlux Colormaps — mostly a wrapper around Kovesi&apos;s CET, matplotlib and SDR community ramps</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://colorcet.com/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>CET — Peter Kovesi&apos;s perceptually-uniform colormaps</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
              </div>
          </CollapsibleSection>
          <Separator />
          <CollapsibleSection title="Resources: Topography, Geomorphometry, Hydrology Scientific Literature and Tools" openAtom={isSettingsGeomorphometryOpenAtom}>
            <div className="space-y-2 text-sm">
                <a href="https://www.whiteboxgeo.com/manuals/qgis/terrain-analysis.html" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>WhiteboxTools Terrain Analysis Manual</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://web.archive.org/web/20251219110853/https://www.whiteboxgeo.com/manual/wbt_book/available_tools/geomorphometric_analysis.html" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>WhiteboxTools Geomorphometric Analysis Manual (Wayback archive, with screenshots)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://www.cnr.it/sites/default/files/public/media/attivita/editoria/Proceedings_Geomorphometry_2020-compressed.pdf" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>Geomorphometry 2020 Conference Proceedings (PDF)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://www.irpi.cnr.it/wp-content/uploads/2026/03/Proceedings_Geomorphometry_2025.pdf" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>Geomorphometry 2025 Conference Proceedings (PDF)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://geomorphometry.fns.uniba.sk/calc-service/lsp_calculator" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>LSP Calculator — land surface parameters web service</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://github.com/xiceph/physical-geomorphometry-tools/tree/main/lsp-calculator" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>LSP Calculator — source code</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
              </div>
          </CollapsibleSection>

        </div>
      </DialogContent>
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