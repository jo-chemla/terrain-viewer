// One static page per app mode, each with its own social preview.
//
// A link preview (Open Graph, Twitter card) is read by a crawler that does
// not run JavaScript and, on a static host, gets the same file whatever the
// query string says: `/?appMode=rem` can never have another picture than `/`.
// A path can. The build therefore writes `dist/rem/index.html` and
// `dist/historical/index.html`: the app's own index.html with the title,
// description, canonical address and preview tags of that mode, plus one
// line that runs first and puts the address back to `/?appMode=<mode>` (the
// query string and the hash kept) before the app starts. The app then runs
// from the root as it always does, so nothing in it has to know about the
// path (its files are fetched relative to the document: `./coverage/...`).
//
//   /rem/?lat=33.15&lng=-91.13   →  /?appMode=rem&lat=33.15&lng=-91.13
//
// Used by vite.config.ts (the build writes the files, the dev server answers
// the same paths). The picture addresses are absolute, on the main domain:
// a preview picture may be on another host than the page.

const SITE = "https://terrain-viewer.iconem.com"

/** The preview of the root page too (index.html carries the same values; the
 *  build checks they agree). */
export const DEFAULT_PREVIEW = {
  image: `${SITE}/og/river-rem.jpg`,
  imageAlt: "A relative elevation model of the lower Mississippi beside Harold Fisk's 1944 map of its former courses",
}

export const MODE_PAGES = [
  {
    path: "rem",
    appMode: "rem",
    url: `${SITE}/rem/`,
    canonical: `${SITE}/rem/`,
    // The host that is this mode and nothing else, when one is pointed here.
    host: "https://river-rem.iconem.com/",
    title: "River REM: height above the river, live in the browser",
    description: "Relative elevation models of any river, computed in the browser from open terrain: meander scars, terraces, levees and old channels, side by side with historical maps. Free and open source.",
    image: DEFAULT_PREVIEW.image,
    imageAlt: DEFAULT_PREVIEW.imageAlt,
  },
  {
    path: "historical",
    appMode: "historical",
    url: `${SITE}/historical/`,
    // The historical host is this mode's own address: one page to rank. (Not
    // og:url: a preview crawler follows og:url and would read that host's
    // root page instead of this one.)
    canonical: "https://historical-satellite.iconem.com/",
    host: "https://historical-satellite.iconem.com/",
    title: "Historical Satellite Imagery: Esri Wayback, Google Earth and open archives by date",
    description: "Free viewer for historical satellite and aerial imagery: Esri World Imagery Wayback, Google Earth timelapse, Bing dated imagery, national archives and open post-disaster data on one timeline, side by side or swiped.",
    image: `${SITE}/og/historical.jpg`,
    imageAlt: "Four dated satellite views of the same place in a grid, above a timeline of the imagery available there",
  },
]

const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

/** Replaces the `content` (or `href`) of the one tag matching `tag`, and
 *  throws when it is not there: a renamed tag in index.html must fail the
 *  build, not ship a page with the root's preview. */
function setAttr(html, tag, attr, value) {
  const re = new RegExp(`(<${tag}[^>]*?\\s${attr}=")[^"]*(")`)
  if (!re.test(html)) throw new Error(`mode-pages: no <${tag} … ${attr}="…"> in index.html`)
  return html.replace(re, (_, a, b) => a + escAttr(value) + b)
}

/** index.html (built or dev) turned into the page of one mode.
 *  `root`: the page stays at the root of a deployment that is that mode's
 *  own host (SITE_MODE, see vite.config.ts): the tags only, no change of
 *  address, and the host as the canonical address. */
export function modePageHtml(html, page, { root = false } = {}) {
  let out = html
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${escAttr(page.title)}</title>`)
  out = setAttr(out, 'link rel="canonical"', "href", root ? page.host : page.canonical)
  out = setAttr(out, 'meta name="description"', "content", page.description)
  out = setAttr(out, 'meta name="og:title" property="og:title"', "content", page.title)
  out = setAttr(out, 'meta name="og:description" property="og:description"', "content", page.description)
  out = setAttr(out, 'meta name="og:image" property="og:image"', "content", page.image)
  out = setAttr(out, 'meta property="og:image:alt"', "content", page.imageAlt)
  out = setAttr(out, 'meta property="og:url"', "content", root ? page.host : page.url)
  out = setAttr(out, 'meta name="twitter:title"', "content", page.title)
  out = setAttr(out, 'meta name="twitter:description"', "content", page.description)
  out = setAttr(out, 'meta name="twitter:image"', "content", page.image)
  out = setAttr(out, 'meta name="twitter:image:alt"', "content", page.imageAlt)
  if (root) return out
  // The build's own files are addressed relative to the document ("./assets/…",
  // vite's base "./"): one level up from here. "../" is right before and after
  // the address is put back to the root (the root has no parent to climb to).
  out = out.replace(/\b(src|href)="\.\//g, '$1="../')
  // First thing in <head>, before any script reads the address.
  const boot = `<script>(function(){try{var s=location.search;if(!/[?&]appMode=/.test(s))s=(s.length>1?s+"&":"?")+"appMode="+${JSON.stringify(page.appMode)};history.replaceState(history.state,"","../"+s+location.hash)}catch(e){}})()</script>`
  if (!/<head>/.test(out)) throw new Error("mode-pages: no <head> in index.html")
  return out.replace(/<head>/, `<head>\n    ${boot}`)
}
