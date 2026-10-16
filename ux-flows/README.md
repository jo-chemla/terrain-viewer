# UX flows (`/ux-flows`)

A map of the app's screens and the flows a user walks through them, with a real screenshot on every
screen: a sitemap, a canvas board that lights the routes into and out of a screen, and user flows
authored as Mermaid with a player that follows branch choices. Every screen carries an evidence tag
(Observed, Specified, Not captured), so the page documents what the app actually did when it was shot.

Because every Terrain Viewer setting lives in the URL, most screens are captured by opening a URL and
taking a screenshot. States the URL cannot carry (picked points, a docked profile, a routing choice)
list the in-app actions that agent-browser replays before the shot.

## The UX flows source of truth

Two sets of text files under `maps/` are the source of truth. Everything the page shows is derived from them; nothing in the viewer's code knows about any particular screen or flow.

- **`screens.json`** is the registry of screens: id, group, label, the "how you get there" sentence, the URL parameters that produce the state, and for a few screens the agent-browser actions to replay. The sitemap tree, the groups, the inspector's URL state table and every capture URL come from it.
- **`compare.md`, `relief.md`, `picker.md`** are the flows: an intro, notes and one Mermaid `flowchart TD` block each, whose node ids are screen ids from the registry. Arrow style carries meaning (thick `==>` main route, thin `-->` alternative, dotted `-.->` way back), diamond `{ }` nodes are decisions. The Flows diagram, the player's steps and branches, the Canvas arrows and the "reached from / leads to" links are all derived from those blocks.

`scripts/build-data.mjs` joins the two with the capture manifest into `data.json`, the only thing the viewer reads. That file and the screenshots are build outputs, published to the `ux-flows-assets` branch and as release assets, never on `main`. To add or change a screen or a flow, edit those files and recapture. The Mermaid parser handles the subset used there: node declarations with `[ ]`, `{ }` and `([ ])` shapes, the three arrow styles and `|label|` edge labels; subgraphs and styling directives are not supported.

## Where things are

```
ux-flows/maps/screens.json   the screen registry: id, label, group, how, the URL params of that state, optional actions
ux-flows/maps/*.md           one flow per file: title, intro, notes and a ```mermaid block whose node ids are screen ids
ux-flows/scripts/capture.mjs agent-browser: open each screen's URL at 1440×900, clear local storage, replay actions, shoot WebP into out/
ux-flows/scripts/build-data.mjs  parses the flows + registry + out/captures.json into out/data.json
ux-flows/src/                the viewer (React): Map (sitemap, stage, inspector, player), Canvas, Flows (Mermaid)
ux-flows/index.html          second entry of the app's Vite build → dist/ux-flows/index.html, i.e. /ux-flows/
ux-flows/out/                captures and data.json: gitignored, published to the ux-flows-assets branch and the release
.github/workflows/ux-flows-capture.yml  manual workflow: capture, build data.json, publish to the ux-flows-assets branch and the ux-flows-latest release
```

The viewer reads `data.json` and the screenshots from one base: in production the orphan `ux-flows-assets`
branch through raw.githubusercontent.com (release downloads send no CORS headers, so the page cannot fetch
`data.json` from the release, which is kept for people), in dev `ux-flows/out/`. `?assets=<url>` points it elsewhere.
Nothing from a capture run is committed, and the app build never captures anything: `/ux-flows` is
a few hundred KB of viewer that deploys with the app like any other page.

## Commands

```
pnpm ux-flows:capture                  # every screen, about 20 s each, scripted ones a minute or two
node ux-flows/scripts/capture.mjs rv_lrm rv_svf   # just these
pnpm ux-flows:data                     # out/data.json
pnpm app                               # then open http://localhost:5173/ux-flows/
UX_FLOWS_BASE_URL=http://localhost:5173/ pnpm ux-flows:capture   # shoot a dev server instead of production
```

The first run needs a browser for agent-browser: `pnpm exec agent-browser install`.

## Flows

- **F1** Compare two terrain sources: overlay, match colours, difference blend, slider, blend on/off loop;
  side by side, 2×2, historical imagery with A on Esri and B/C/D on dated Wayback and Google Earth.
- **F2** Relief visualization modes at the Matterhorn: LRM, SVF, Openness, with range edits.
- **F3** Elevation picker at Zermatt: two picked points and their profile, docked under the map, BRouter
  and Valhalla routing with a routing profile, line of sight with a mast, then the plane slicer.

Every screen sets `openSections=<key>&scrollTo=<key>` so the sidebar shows the section in use
(`comparisonMix`, `hillshade`, `reliefVisualization`, `elevationPicker`, `lightingEffects`, …).

## Extending

1. **A screen**: one object in `maps/screens.json` with a new `id`, its `group`, a `how` sentence and
   the `params` that produce that state. Capture just that id.
2. **A flow**: a new `maps/<name>.md` with `# F4 · Title`, an `Intro:` line and a Mermaid `flowchart TD`
   block whose node ids are screen ids. `==>` is the main route, `-->` an alternative, `-.->` optional or
   a way back. `{ }` nodes are decisions, with no screenshot. Steps are the Mermaid declaration order.
3. **A group**: an entry in `groups`, with an optional `parent`.
4. **An action-driven screen**: add `actions`, replayed by agent-browser before the shot:

```
"actions": [
  { "find": "switch \"Pick elevation on click\"", "do": "click" },   // regex over a `snapshot -i` line; first match's ref
  { "mouse": [300, 450] }, { "wait": 2500 },                            // a click on the map at viewport pixels
  { "find": "combobox .*Straight line", "do": "click", "settle": 800 },
  { "find": "option \"BRouter\"", "do": "click", "settle": 9000 },
  { "find": "spinbutton \"Mast height\"", "do": "fill", "value": "30" }
],
"actionsFrom": "ep_dock"      // replay another screen's actions first, then these
```

An action whose target never appears (a control renamed or removed) fails that capture, which the
page shows as Not captured, rather than shooting the wrong state. Pure URL screens cannot fail that
way; they only tell you something when you look at them.

## Address scheme

`#view=map|canvas|flows&node=<screen>&flow=<F1>&step=<n>&branches=<decisionMid>:<chosenMid>,…`

Branch choices are encoded only where they differ from the default way on, so a link reproduces a
path exactly. ← → or [ ] step through the playing flow.
