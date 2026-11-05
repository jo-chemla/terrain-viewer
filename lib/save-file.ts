import saveAs from "file-saver"
import { zipSync, type Zippable } from "fflate"

// One place the exports write files through, so a run can be gathered into a
// single .zip instead of one browser download per file. The Export layers
// dialog writes through its own code, through the section's DEM export and
// through lib/download-geojson.ts: a bundle opened here catches all three
// without threading a sink through each of them.
let bundle: Map<string, Blob> | null = null

/** Saves a file, or adds it to the open zip bundle when there is one. */
export function saveFile(blob: Blob, name: string) {
  if (bundle) bundle.set(name, blob)
  else saveAs(blob, name)
}

/** From here on, saveFile() gathers files until finishZipBundle() or discardZipBundle(). */
export function beginZipBundle() {
  bundle = new Map()
}

export function discardZipBundle() {
  bundle = null
}

/** Writes the gathered files as `<name>.zip` and closes the bundle. Returns
 *  how many files went in (0: nothing is written). */
export async function finishZipBundle(name: string): Promise<number> {
  const files = bundle
  bundle = null
  if (!files || files.size === 0) return 0
  const input: Zippable = {}
  for (const [fileName, blob] of files) {
    // Images are compressed already; a float GeoTIFF or GeoJSON is not, and
    // the fastest deflate level takes a good share off both.
    const stored = /\.(jpe?g|png|webp)$/i.test(fileName)
    input[fileName] = [new Uint8Array(await blob.arrayBuffer()), { level: stored ? 0 : 1 }]
  }
  saveAs(new Blob([zipSync(input) as BlobPart], { type: "application/zip" }), `${name}.zip`)
  return files.size
}
