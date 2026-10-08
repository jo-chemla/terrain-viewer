// "Add a catalog" for the historical timeline's My catalogs group
// (historical-catalog-tree.tsx): a STAC API or a static catalog.json, from the
// STAC presets, the catalogs saved in the STAC search, or a pasted URL;
// optionally one collection (an API's /collections, or a static tree's
// children); a name (the pill shows its first words). The entry lands in
// customTimelineCatalogsAtom under a self-describing id (stacCatalogId), and
// the tree ticks it on. What it loads and whether the catalog answers a
// browser at all shows in the tree's count or error, as for every catalog.
import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { useAtomValue } from "jotai"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { STAC_PRESETS } from "@/lib/stac-presets"
import { fetchNode, listCollections, resolveHref, trimSlash, explainFetchError, type StacCollection } from "@/lib/stac-crawl"
import { customTimelineCatalogsAtom, savedStacCatalogsAtom, type CustomTimelineCatalog } from "@/lib/settings-atoms"
import { stacCatalogId, nextStacCatalogColor } from "@/lib/timeline-catalogs"

const CUSTOM = "__custom__"
const ALL = "__all__"
/** A pill-sized name: the first words of the title, up to 14 characters. */
export const shortNameOf = (title: string): string => {
  const words = title.replace(/\(.*?\)/g, "").trim().split(/\s+/)
  let out = ""
  for (const w of words) { if ((out + " " + w).trim().length > 14) break; out = (out + " " + w).trim() }
  return out || title.slice(0, 14)
}
/** Static catalog: a child's title, else the last path segment of its URL. */
const childTitle = (href: string, title?: string) => title ?? href.split("/").filter((p) => p && !/^(catalog|collection)\.json$/.test(p)).pop() ?? href

export const AddTimelineCatalogDialog: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (entry: CustomTimelineCatalog) => void
}> = ({ open, onOpenChange, onAdd }) => {
  const saved = useAtomValue(savedStacCatalogsAtom)
  const existing = useAtomValue(customTimelineCatalogsAtom)
  // Imagery catalogs only (a DEM catalog has nothing to drape), APIs and
  // static trees (a discovery federation has no items of its own).
  const presets = useMemo(() => [
    ...STAC_PRESETS.filter((p) => p.target !== "terrain" && p.kind !== "discovery"),
    ...saved.filter((c) => c.target !== "terrain").map((c) => ({ id: c.id, name: c.name, url: c.url, kind: c.kind, group: "Yours" as const })),
  ], [saved])
  const [presetId, setPresetId] = useState(presets[0]?.id ?? CUSTOM)
  const [customUrl, setCustomUrl] = useState("")
  const preset = presets.find((p) => p.id === presetId)
  const endpoint = trimSlash((preset?.url ?? customUrl).trim())
  const kind: "api" | "static" = preset ? (preset.kind === "static" ? "static" : "api") : /\.json($|\?)/i.test(endpoint) ? "static" : "api"
  const [collections, setCollections] = useState<StacCollection[]>([])
  const [collectionId, setCollectionId] = useState(ALL)
  const [listing, setListing] = useState(false)
  const [error, setError] = useState("")
  const [label, setLabel] = useState("")
  const [touched, setTouched] = useState(false)

  // The collections of the chosen endpoint (API: /collections, paged;
  // static: the root's children), listed as soon as the URL is a URL.
  useEffect(() => {
    setCollections([]); setCollectionId(ALL); setError("")
    if (!/^https?:\/\/\S+/.test(endpoint)) return
    let cancelled = false
    setListing(true)
    ;(async () => {
      try {
        if (kind === "static") {
          const root = await fetchNode(endpoint)
          if (!root) throw new Error(`Could not read ${endpoint}`)
          const children = (root.links ?? []).filter((l) => l.rel === "child")
          if (!cancelled) setCollections(children.map((l) => ({ id: resolveHref(endpoint, l.href), title: childTitle(l.href, l.title) })))
        } else {
          await listCollections(endpoint, (sofar) => { if (!cancelled) setCollections(sofar) })
        }
      } catch (e) { if (!cancelled) setError(explainFetchError(e, "Could not list the catalog")) }
      finally { if (!cancelled) setListing(false) }
    })()
    return () => { cancelled = true }
  }, [endpoint, kind])

  const collection = collectionId === ALL ? undefined : collectionId
  const collectionTitle = collection ? collections.find((c) => c.id === collection)?.title || collection : ""
  // Suggested names follow the choice until the visitor edits them.
  const suggestedLabel = useMemo(() => {
    const base = preset?.name ?? (() => { try { return new URL(endpoint).host } catch { return endpoint } })()
    return collectionTitle ? `${base} · ${collectionTitle}` : base
  }, [preset, endpoint, collectionTitle])
  useEffect(() => { if (!touched) setLabel(suggestedLabel) }, [suggestedLabel, touched])
  // The pill's name: the collection's first words while the name is the
  // suggested one, else the first words of what was typed.
  const short = shortNameOf(collectionTitle && label === suggestedLabel ? collectionTitle : label)

  const id = /^https?:\/\/\S+/.test(endpoint) ? stacCatalogId({ endpoint, kind, collection }) : ""
  const already = !!id && existing.some((c) => c.id === id)
  const canAdd = !!id && !!label.trim() && !already
  const add = () => {
    if (!canAdd) return
    onAdd({ id, label: label.trim(), short: short.trim(), endpoint, kind, collection, color: nextStacCatalogColor(existing) })
    onOpenChange(false)
  }
  const presetItems = useMemo(() => Object.fromEntries([[CUSTOM, "A catalog URL…"], ...presets.map((p) => [p.id, p.name])]), [presets])
  const collectionItems = useMemo(() => Object.fromEntries([[ALL, kind === "static" ? `The whole catalog (${collections.length} children)` : `All collections (${collections.length})`], ...collections.map((c) => [c.id, c.title || c.id])]), [collections, kind])
  const groups = ["Yours", "Imagery", "Mixed", "Elevation", "Registries"] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a catalog to the timeline</DialogTitle>
          <DialogDescription>A STAC API or a static catalog.json: its items covering the view become ticks under My STAC catalogs, like the open-data catalogs. The browser must be allowed to read it (CORS).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 min-w-0">
          <div className="space-y-1 min-w-0">
            <Label className="text-xs">Catalog</Label>
            <Select value={presetId} onValueChange={(v) => { if (v) setPresetId(v) }} items={presetItems}>
              <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={CUSTOM}>A catalog URL…</SelectItem>
                {groups.map((g) => {
                  const rows = presets.filter((p) => p.group === g)
                  return rows.length ? (
                    <SelectGroup key={g}>
                      <SelectLabel>{g}</SelectLabel>
                      {rows.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectGroup>
                  ) : null
                })}
              </SelectContent>
            </Select>
            {presetId === CUSTOM && (
              <Input placeholder="https://…/v1 (API) or https://…/catalog.json (static)" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} className="cursor-text" />
            )}
            {endpoint && <p className="text-[11px] text-muted-foreground truncate" title={endpoint}>{kind === "api" ? "STAC API" : "Static catalog"} · {endpoint}</p>}
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-xs flex items-center gap-1.5">{kind === "static" ? "Part of the catalog" : "Collection"}{listing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}</Label>
            <Select value={collectionId} onValueChange={(v) => setCollectionId(v || ALL)} items={collectionItems}>
              <SelectTrigger className="w-full cursor-pointer" disabled={!collections.length}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={ALL}>{collectionItems[ALL]}</SelectItem>
                {collections.slice(0, 400).map((c) => <SelectItem key={c.id} value={c.id} title={c.title || c.id}>{c.title || c.id}</SelectItem>)}
              </SelectContent>
            </Select>
            {error && <p className="text-[11px] text-destructive break-words">{error}</p>}
          </div>
          <div className="space-y-1 min-w-0">
            <Label htmlFor="tl-cat-label" className="text-xs">Name</Label>
            <Input id="tl-cat-label" value={label} onChange={(e) => { setLabel(e.target.value); setTouched(true) }} className="cursor-text" />
            <p className="text-[11px] text-muted-foreground">On the pills as "{short}".</p>
          </div>
          {already && <p className="text-[11px] text-muted-foreground">This catalog is already in My catalogs.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" className="cursor-pointer" disabled={!canAdd} onClick={add}>Add to the timeline</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
