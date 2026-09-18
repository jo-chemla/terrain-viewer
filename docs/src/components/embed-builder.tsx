'use client';

import { useMemo, useState } from 'react';

const APP = 'https://jo-chemla.github.io/terrain-viewer/';
const isUrl = (v: string) => /^https?:\/\//i.test(v);

// Builds a terrain-viewer link / iframe from a few fields, the way the
// Heritage Watch toolbox builds kepler.gl links. Every field maps to one of
// the parameters documented on the same page; the code block updates live.
export function EmbedBuilder() {
  const [terrainA, setTerrainA] = useState('custom-ca-nrcan-mrdem30');
  const [terrainB, setTerrainB] = useState('');
  const [basemap, setBasemap] = useState('');
  const [drawings, setDrawings] = useState('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_lakes.geojson');
  const [viaTitiler, setViaTitiler] = useState(false);
  const [viewMode, setViewMode] = useState<'2d' | '3d' | 'globe'>('3d');
  const [sidebar, setSidebar] = useState(true);
  const [height, setHeight] = useState(560);
  // Everything in a pasted link that the fields above do not model (camera,
  // viz toggles, dates, ...) is kept verbatim and re-emitted.
  const [extra, setExtra] = useState<[string, string][]>([]);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState('');

  const OWN = new Set(['sourceA', 'terrainSourceA', 'sourceB', 'terrainSourceB', 'basemapSource', 'basemapSourceA', 'drawingUrl', 'viaTitiler', 'viewMode', 'sidebar', 'splitStyle', 'showRasterBasemap']);

  // Populates the fields from a real terrain-viewer link, so a view set up
  // in the app can be turned into an iframe with only the embed options
  // changed. Both spellings of the terrain keys are accepted.
  const parseLink = (value: string) => {
    setPasteError('');
    let u: URL;
    try { u = new URL(value.trim()); } catch { setPasteError('Not a URL'); return; }
    const p = u.searchParams;
    setTerrainA(p.get('terrainSourceA') ?? p.get('sourceA') ?? '');
    setTerrainB(p.get('terrainSourceB') ?? p.get('sourceB') ?? '');
    setBasemap(p.get('basemapSourceA') ?? p.get('basemapSource') ?? '');
    setDrawings(p.getAll('drawingUrl').join('\n'));
    setViaTitiler(['1', 'true'].includes(p.get('viaTitiler') ?? ''));
    const vm = p.get('viewMode');
    if (vm === '2d' || vm === '3d' || vm === 'globe') setViewMode(vm);
    setSidebar(p.get('sidebar') !== 'closed');
    setExtra(Array.from(p.entries()).filter(([k]) => !OWN.has(k)));
  };

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (terrainA.trim()) p.set('terrainSourceA', terrainA.trim());
    if (terrainB.trim()) {
      p.set('terrainSourceB', terrainB.trim());
      p.set('splitStyle', extra.find(([k]) => k === 'splitStyle')?.[1] ?? 'side-by-side');
    }
    if (basemap.trim()) {
      p.set('basemapSource', basemap.trim());
      p.set('showRasterBasemap', 'true');
    }
    for (const d of drawings.split(/\n/).map((s) => s.trim()).filter(isUrl)) p.append('drawingUrl', d);
    if (viaTitiler) p.set('viaTitiler', '1');
    p.set('viewMode', viewMode);
    if (!sidebar) p.set('sidebar', 'closed');
    for (const [k, v] of extra) if (!p.has(k)) p.append(k, v);
    return `${APP}?${p.toString()}`;
  }, [terrainA, terrainB, basemap, drawings, viaTitiler, viewMode, sidebar, extra]);

  const iframe = `<iframe\n  src="${url}"\n  width="100%" height="${height}"\n  style="border: 0"\n  allow="fullscreen; clipboard-write"\n  loading="lazy"\n></iframe>`;

  const field = 'w-full rounded-md border border-fd-border bg-fd-background px-2 py-1 text-sm';
  const label = 'block text-xs font-medium text-fd-muted-foreground mb-1';

  return (
    <div className="not-prose my-6 grid gap-4 rounded-lg border border-fd-border p-4 md:grid-cols-2">
      <div className="space-y-3">
        <div>
          <label className={label}>Start from a terrain-viewer link (optional) — paste and press Enter; the fields below fill in, everything else in the link is kept</label>
          <input
            className={field}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') parseLink(pasted); }}
            onBlur={() => { if (pasted.trim()) parseLink(pasted); }}
            placeholder="https://jo-chemla.github.io/terrain-viewer/?lat=…"
          />
          {pasteError && <p className="text-xs text-red-500">{pasteError}</p>}
          {extra.length > 0 && <p className="text-[11px] text-fd-muted-foreground">{extra.length} other parameter{extra.length === 1 ? '' : 's'} carried over from the link ({extra.map(([k]) => k).slice(0, 8).join(', ')}{extra.length > 8 ? ', …' : ''}).</p>}
        </div>
        <div>
          <label className={label}>Terrain, view A — a COG URL, a tile template with {'{z}/{x}/{y}'}, or a library id</label>
          <input className={field} value={terrainA} onChange={(e) => setTerrainA(e.target.value)} placeholder="https://host/dem.tif" />
        </div>
        <div>
          <label className={label}>Terrain, view B (optional — turns on the side-by-side split)</label>
          <input className={field} value={terrainB} onChange={(e) => setTerrainB(e.target.value)} placeholder="https://host/other-dem.tif" />
        </div>
        <div>
          <label className={label}>Basemap (optional — a COG or tile URL, or a built-in id such as esri)</label>
          <input className={field} value={basemap} onChange={(e) => setBasemap(e.target.value)} placeholder="https://host/ortho.tif" />
        </div>
        <div>
          <label className={label}>Drawings — vector data URLs, one per line (GeoJSON, KML, GPX, FlatGeobuf, Shapefile)</label>
          <textarea className={`${field} font-mono text-xs`} rows={3} value={drawings} onChange={(e) => setDrawings(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={viaTitiler} onChange={(e) => setViaTitiler(e.target.checked)} /> COGs through titiler (not Web Mercator)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={sidebar} onChange={(e) => setSidebar(e.target.checked)} /> Side panel open at start</label>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">View
            <select className={field} value={viewMode} onChange={(e) => setViewMode(e.target.value as any)}>
              <option value="2d">2D</option><option value="3d">3D</option><option value="globe">Globe</option>
            </select>
          </label>
          <label className="flex items-center gap-2">Height (px)
            <input type="number" className={`${field} w-24`} value={height} onChange={(e) => setHeight(Number(e.target.value) || 400)} />
          </label>
        </div>
      </div>
      <div className="space-y-3 min-w-0">
        <div>
          <label className={label}>Link</label>
          <a href={url} target="_blank" rel="noopener noreferrer" className="block break-all text-xs underline">{url}</a>
        </div>
        <div>
          <label className={label}>Iframe</label>
          <pre className="overflow-x-auto rounded-md border border-fd-border bg-fd-muted p-3 text-xs"><code>{iframe}</code></pre>
          <button
            type="button"
            className="mt-2 rounded-md border border-fd-border px-2 py-1 text-xs hover:bg-fd-accent"
            onClick={() => navigator.clipboard.writeText(iframe)}
          >
            Copy iframe
          </button>
        </div>
      </div>
    </div>
  );
}
