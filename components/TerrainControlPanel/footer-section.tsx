import type React from "react"
import { useState, useCallback , useRef, useEffect } from "react"
import { ChevronDown, Loader2, RefreshCw } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { useDesktopUpdate, describeDesktopUpdate } from "@/lib/desktop-bridge"
import { CREDITS_MARKDOWN, CREDITS_MARKDOWN_COMPONENTS } from "./settings-dialog"

/** Not a shared `Section` instance on purpose — that component carries
 *  pulse/dimming machinery (breathing-dot activation, cross-section
 *  dimming) tied to viz-mode state, none of which applies to this static
 *  credits block. Same Collapsible primitives, deliberately smaller/muted
 *  title so it doesn't compete with the real sections above it. */
export const FooterSection: React.FC<{
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ isOpen, onOpenChange }) => (
  // No leading Separator here — whichever section renders immediately above
  // (Animation or Source Info, per TerrainControlPanel.tsx) already draws
  // its own trailing one via Section's default withSeparator=true.
  <Collapsible open={isOpen} onOpenChange={onOpenChange}>
    <CollapsibleTrigger className="flex items-center justify-between w-full py-2 cursor-pointer text-xs font-medium text-muted-foreground text-left">
      <span>About</span>
      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-180")} />
    </CollapsibleTrigger>
    <CollapsibleContent className="text-xs text-muted-foreground space-y-1.5 pb-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={CREDITS_MARKDOWN_COMPONENTS}>
        {CREDITS_MARKDOWN}
      </ReactMarkdown>
      {/* Build stamp (vite.config.ts `define`): the day and the commit, with
          the commit linking to it on GitHub, so a report can name the build. */}
      <p className="pt-1 font-mono text-[11px]">
        Version: {__BUILD_DATE__}{" "}
        <a href={`https://github.com/Iconem/terrain-viewer/commit/${__BUILD_COMMIT__}`} target="_blank" rel="noopener noreferrer" className="underline">{__BUILD_COMMIT__}</a>
      </p>
      <DesktopUpdateLine />
      <VersionCheck />
    </CollapsibleContent>
  </Collapsible>
)

// "Is this the latest?": one click asks GitHub for the newest commit on main
// (what the website serves) and for the rolling desktop release (which names
// the commit it was built from), and compares both with this build's commit.
type VersionCheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; web: { sha: string; date: string; same: boolean }; desktop: { sha: string; date: string; same: boolean; url: string } | null }
  | { status: "error"; message: string }
const VersionCheck: React.FC = () => {
  const [state, setState] = useState<VersionCheckState>({ status: "idle" })
  // The answer lands below the fold of the sidebar: bring it into view.
  const answerRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (state.status === "done" || state.status === "error") answerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }) }, [state.status])
  const check = useCallback(async () => {
    setState({ status: "loading" })
    try {
      const api = "https://api.github.com/repos/Iconem/terrain-viewer"
      const [commitRes, releaseRes] = await Promise.all([
        fetch(`${api}/commits/main`, { headers: { Accept: "application/vnd.github+json" } }),
        fetch(`${api}/releases/tags/desktop-latest`, { headers: { Accept: "application/vnd.github+json" } }),
      ])
      if (!commitRes.ok) throw new Error(`GitHub answered ${commitRes.status}`)
      const commit = await commitRes.json()
      const sha: string = String(commit.sha ?? "").slice(0, 7)
      const date: string = String(commit.commit?.committer?.date ?? "").slice(0, 10)
      let desktop: Extract<VersionCheckState, { status: "done" }>["desktop"] = null
      if (releaseRes.ok) {
        const rel = await releaseRes.json()
        const built = /from `([0-9a-f]{7,})`/.exec(String(rel.body ?? ""))?.[1]?.slice(0, 7) ?? ""
        desktop = { sha: built, date: String(rel.published_at ?? "").slice(0, 10), same: !!built && built === __BUILD_COMMIT__, url: String(rel.html_url ?? "https://github.com/Iconem/terrain-viewer/releases/tag/desktop-latest") }
      }
      setState({ status: "done", web: { sha, date, same: sha === __BUILD_COMMIT__ }, desktop })
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }, [])
  return (
    <div className="font-mono text-[11px] space-y-0.5">
      <button type="button" onClick={check} disabled={state.status === "loading"} className="inline-flex items-center gap-1 underline cursor-pointer disabled:opacity-60 disabled:cursor-default">
        {state.status === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        Is this the latest version?
      </button>
      <div ref={answerRef}>
      {state.status === "error" && <p className="text-destructive">Could not reach GitHub: {state.message}</p>}
      {state.status === "done" && (
        <>
          <p>
            Website: {state.web.date} <a href={`https://github.com/Iconem/terrain-viewer/commit/${state.web.sha}`} target="_blank" rel="noopener noreferrer" className="underline">{state.web.sha}</a>
            {state.web.same ? " — this build is the latest" : " — newer than this build; reload the page to get it"}
          </p>
          {state.desktop && (
            <p>
              Desktop bundles: {state.desktop.date} from {state.desktop.sha || "?"}
              {state.desktop.same ? " — same commit as this build" : ""}
              {" · "}<a href={state.desktop.url} target="_blank" rel="noopener noreferrer" className="underline">release page</a>
            </p>
          )}
        </>
      )}
      </div>
    </div>
  )
}

// Desktop app only: the updater's state (checking, downloading with its
// percentage, downloaded, installing, installed at this launch). Renders
// nothing in the browser.
const DesktopUpdateLine: React.FC = () => {
  const update = useDesktopUpdate()
  const line = describeDesktopUpdate(update)
  if (!line) return null
  return <p className="font-mono text-[11px]">{line}</p>
}
