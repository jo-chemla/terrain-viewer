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
