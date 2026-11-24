// Run with: node scripts/test-lib.mjs lib/source-credit.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { sourceCredit } from "./source-credit.ts"

test("the entry's attribution, linked to its page", () => {
  assert.equal(
    sourceCredit({ name: "Tikal SVF", attribution: "MARI-GISLAB, CC BY-NC-SA 4.0", infoUrl: "https://example.org/a?b=1&c=2" }),
    '<a href="https://example.org/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">MARI-GISLAB, CC BY-NC-SA 4.0</a>',
  )
})

test("the name when there is no attribution, escaped", () => {
  assert.equal(sourceCredit({ name: "My <b>map</b> & co" }), "My &lt;b&gt;map&lt;/b&gt; &amp; co")
})

test("an attribution that already holds a link is kept as written", () => {
  const html = '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>'
  assert.equal(sourceCredit({ name: "OSM", attribution: html, infoUrl: "https://x.org" }), html)
})

test("nothing to credit, or a non-web page, gives no link", () => {
  assert.equal(sourceCredit(null), undefined)
  assert.equal(sourceCredit({ name: "  " }), undefined)
  assert.equal(sourceCredit({ name: "Local", infoUrl: "javascript:alert(1)" }), "Local")
})

test("the short credit when there is one, linked to the licence so a publisher's items merge", () => {
  const cc = "https://creativecommons.org/licenses/by-nc-sa/4.0/"
  const a = sourceCredit({ name: "Tikal SVF", attribution: "Middle American Research Institute GIS LAB (MARI-GISLAB) at Tulane University, Estrada-Belli et al. 2023. CC BY-NC-SA 4.0", shortAttribution: "MARI-GISLAB (Tulane), CC BY-NC-SA", infoUrl: "https://www.arcgis.com/home/item.html?id=1", licenseUrl: cc })
  const b = sourceCredit({ name: "Holmul SVF", attribution: "…, NCALM, Estrada-Belli et al. 2023. CC BY-NC-SA 4.0", shortAttribution: "MARI-GISLAB (Tulane), CC BY-NC-SA", infoUrl: "https://www.arcgis.com/home/item.html?id=2", licenseUrl: cc })
  assert.equal(a, `<a href="${cc}" target="_blank" rel="noopener noreferrer">MARI-GISLAB (Tulane), CC BY-NC-SA</a>`)
  assert.equal(a, b)
})

test("a short credit with no licence page links to the landing page", () => {
  assert.equal(
    sourceCredit({ attribution: "USGS The National Map: 3D Elevation Program", shortAttribution: "USGS 3DEP", infoUrl: "https://www.usgs.gov/3d-elevation-program" }),
    '<a href="https://www.usgs.gov/3d-elevation-program" target="_blank" rel="noopener noreferrer">USGS 3DEP</a>',
  )
})

test("a source added before the short credit takes the Library's, unless its credit was edited", () => {
  const lib = { attribution: "Long credit", shortAttribution: "Short", licenseUrl: "https://lic.org" }
  assert.equal(sourceCredit({ attribution: "Long credit", infoUrl: "https://item.org" }, lib), '<a href="https://lic.org" target="_blank" rel="noopener noreferrer">Short</a>')
  assert.equal(sourceCredit({ attribution: "My own credit", infoUrl: "https://item.org" }, lib), '<a href="https://item.org" target="_blank" rel="noopener noreferrer">My own credit</a>')
})
