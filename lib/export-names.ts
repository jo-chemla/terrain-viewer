// One naming scheme for every file the app exports:
//   <export name>_<part>.<ext>
// where the export name defaults to terrain-viewer_<YYYY-MM-DD-HH-MM> (local
// time, the moment the export was started) and the export dialog lets the
// user replace it ("maya", "site-12"...). Parts: dem, snapshot, basemap,
// rendered_hillshade, terrain-analysis_slope, ..._colormapped, contours...

/** Local date and time to the minute: 2026-09-27-10-42. */
export function exportStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}`
}

export function defaultExportName(d?: Date): string {
  return `terrain-viewer_${exportStamp(d)}`
}

/** A user-typed name made safe for a file name; the default when empty. */
export function sanitizeExportName(s: string): string {
  const clean = s.trim().replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "")
  return clean || defaultExportName()
}
