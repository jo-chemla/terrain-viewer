import { type DesignSystem, type Page, type SlideMeta, useSlidePageNumber } from '@open-slide/core';
import type { CSSProperties, ReactNode } from 'react';

import pickerFull from '@assets/screenshots/tools/elevation-picker-full.jpg';
import draw from '@assets/screenshots/tools/draw.jpg';
import animation from '@assets/screenshots/tools/animation.jpg';
import sunReverse from '@assets/screenshots/sun-shadow-calculator-reverse.jpg';
import sunDatetime from '@assets/screenshots/sun-datetime-control.jpg';
import stacCatalogs from '@assets/screenshots/stac-catalogs.jpg';
import byodAdd from '@assets/screenshots/byod-add-dataset.jpg';
import byodDiff from '@assets/screenshots/byod-difference-dsm-dtm.jpg';
import contours from '@assets/screenshots/viz-modes/contours.jpg';
import buildingShadows from '@assets/screenshots/viz-modes/building-shadows.jpg';
import exportLayers from '@assets/screenshots/export-share/export-layers-dialog.jpg';
import downloadSection from '@assets/screenshots/export-share/download-section.jpg';
import embedHost from '@assets/screenshots/ui/embedding-host-page.jpg';
import openIn from '@assets/screenshots/ui/open-in-launcher.jpg';

// ─── Shared Terrain Viewer deck kit (same in every terrain-viewer deck) ───────

export const design: DesignSystem = {
  palette: { bg: '#0c1322', text: '#eef2f8', accent: '#f5b84a' },
  fonts: {
    display: 'Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    body: 'Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  },
  typeScale: { hero: 132, body: 32 },
  radius: 14,
};

const DECK = 'Tools';
const muted = '#93a4bd';
const dim = '#5f6f88';
const teal = '#4fd1c5';
const rule = 'rgba(255,255,255,0.10)';
const panel = 'rgba(255,255,255,0.045)';
const mono = '"JetBrains Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace';

const PAD_X = 110;
const PAD_TOP = 84;

const fill: CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
  overflow: 'hidden',
  background: 'var(--osd-bg)',
  color: 'var(--osd-text)',
  fontFamily: 'var(--osd-font-body)',
  WebkitFontSmoothing: 'antialiased',
};

const Footer = () => {
  const { current, total } = useSlidePageNumber();
  return (
    <div
      style={{
        position: 'absolute',
        left: PAD_X,
        right: PAD_X,
        bottom: 44,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 20,
        color: dim,
        letterSpacing: '0.02em',
      }}
    >
      <span>
        <span style={{ color: 'var(--osd-accent)' }}>▲</span> Terrain Viewer · {DECK} · terrain-viewer.iconem.com
      </span>
      <span style={{ fontFamily: mono }}>
        {String(current).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </div>
  );
};

const Frame = ({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children: ReactNode }) => (
  <div style={{ ...fill, padding: `${PAD_TOP}px ${PAD_X}px 0` }}>
    <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--osd-accent)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
      {eyebrow}
    </div>
    <h2
      style={{
        fontFamily: 'var(--osd-font-display)',
        fontSize: 62,
        fontWeight: 800,
        letterSpacing: '-0.02em',
        lineHeight: 1.12,
        margin: '14px 0 36px',
      }}
    >
      {title}
    </h2>
    <div style={{ height: 790, position: 'relative' }}>{children}</div>
    <Footer />
  </div>
);

const Bullets = ({ children, size = 31 }: { children: ReactNode; size?: number }) => (
  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 16, fontSize: size, lineHeight: 1.4 }}>
    {children}
  </ul>
);

const Li = ({ children, k }: { children: ReactNode; k?: ReactNode }) => (
  <li style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
    <span style={{ color: 'var(--osd-accent)', fontSize: 20, flex: 'none', transform: 'translateY(-4px)' }}>◆</span>
    <span>
      {k ? <b style={{ color: '#fff', fontWeight: 700 }}>{k} </b> : null}
      <span style={{ color: k ? muted : 'var(--osd-text)' }}>{children}</span>
    </span>
  </li>
);

const Shot = ({
  src,
  caption,
  width = 900,
  height,
  fit = 'cover',
  position = 'top',
}: {
  src: string;
  caption?: string;
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain';
  position?: string;
}) => (
  <figure style={{ margin: 0, width, flex: 'none' }}>
    <img
      src={src}
      style={{
        width,
        height: height ?? Math.round(width * 0.5625),
        objectFit: fit,
        objectPosition: position,
        borderRadius: 'var(--osd-radius)',
        border: `1px solid ${rule}`,
        boxShadow: '0 24px 60px -24px rgba(0,0,0,0.8)',
        display: 'block',
        background: '#000',
      }}
    />
    {caption ? <figcaption style={{ fontSize: 21, color: dim, marginTop: 14, lineHeight: 1.35 }}>{caption}</figcaption> : null}
  </figure>
);

const TwoCol = ({ left, right, leftWidth = 740 }: { left: ReactNode; right: ReactNode; leftWidth?: number }) => (
  <div style={{ display: 'flex', gap: 60, alignItems: 'flex-start' }}>
    <div style={{ width: leftWidth, flex: 'none' }}>{left}</div>
    <div style={{ flex: 1, minWidth: 0 }}>{right}</div>
  </div>
);

const Card = ({ title, children, accent = 'var(--osd-accent)' }: { title: ReactNode; children: ReactNode; accent?: string }) => (
  <div
    style={{
      background: panel,
      border: `1px solid ${rule}`,
      borderTop: `4px solid ${accent}`,
      borderRadius: 'var(--osd-radius)',
      padding: '26px 30px',
      flex: 1,
      minWidth: 0,
    }}
  >
    <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 14 }}>{title}</div>
    <div style={{ fontSize: 25, lineHeight: 1.45, color: muted }}>{children}</div>
  </div>
);

const Code = ({ children, size = 25 }: { children: ReactNode; size?: number }) => (
  <pre
    style={{
      margin: 0,
      fontFamily: mono,
      fontSize: size,
      lineHeight: 1.5,
      background: 'rgba(0,0,0,0.35)',
      border: `1px solid ${rule}`,
      borderRadius: 12,
      padding: '20px 26px',
      color: '#dbe4f3',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}
  >
    {children}
  </pre>
);

const Row = ({ k, v }: { k: ReactNode; v: ReactNode }) => (
  <div style={{ display: 'flex', gap: 24, padding: '12px 0', borderBottom: `1px solid ${rule}`, fontSize: 26, lineHeight: 1.35 }}>
    <div style={{ width: 300, flex: 'none', fontWeight: 700 }}>{k}</div>
    <div style={{ color: muted }}>{v}</div>
  </div>
);

const Cover = ({ bg, eyebrow, title, subtitle }: { bg: string; eyebrow: string; title: ReactNode; subtitle: ReactNode }) => (
  <div style={fill}>
    <img src={bg} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(90deg, rgba(12,19,34,0.96) 0%, rgba(12,19,34,0.85) 45%, rgba(12,19,34,0.25) 100%)',
      }}
    />
    <div style={{ position: 'absolute', left: PAD_X, right: PAD_X, top: 300 }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--osd-accent)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>{eyebrow}</div>
      <h1
        style={{
          fontFamily: 'var(--osd-font-display)',
          fontSize: 'var(--osd-size-hero)',
          fontWeight: 900,
          letterSpacing: '-0.035em',
          lineHeight: 1.0,
          margin: '28px 0 36px',
          maxWidth: 1300,
        }}
      >
        {title}
      </h1>
      <p style={{ fontSize: 36, color: muted, margin: 0, maxWidth: 1100, lineHeight: 1.4 }}>{subtitle}</p>
    </div>
    <div style={{ position: 'absolute', left: PAD_X, bottom: 56, fontSize: 24, color: muted, fontFamily: mono }}>
      terrain-viewer.iconem.com/docs/features/tools
    </div>
  </div>
);

const Closing = ({ title, lines }: { title: ReactNode; lines: ReactNode[] }) => (
  <div style={{ ...fill, padding: `${PAD_TOP}px ${PAD_X}px 0` }}>
    <div style={{ position: 'absolute', left: PAD_X, right: PAD_X, top: 260 }}>
      <h1 style={{ fontFamily: 'var(--osd-font-display)', fontSize: 104, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.02, margin: '0 0 56px' }}>
        {title}
      </h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, fontSize: 32, fontFamily: mono, color: muted }}>
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
    <Footer />
  </div>
);

// ─── Pages ──────────────────────────────────────────────────────────────────

const P1Cover: Page = () => (
  <Cover
    bg={pickerFull}
    eyebrow="Advanced tools"
    title={
      <>
        Measure, draw,
        <br />
        bring your own
      </>
    }
    subtitle="Profiles, shadows, georeferencing, catalogs, derived terrain, exports and embeds: the Tools group and the dialogs around it."
  />
);

const P2Picker: Page = () => (
  <Frame eyebrow="Elevation picker" title="Point, delta, profile, line of sight, slicer">
    <TwoCol
      leftWidth={760}
      left={
        <Bullets size={29}>
          <Li k="Point">one click reads the active DEM, the same source the rest of the app draws.</Li>
          <Li k="Delta">a second click: distance and Δ elevation.</Li>
          <Li k="Line profile">a chart along the path; a mast height for a line-of-sight check.</Li>
          <Li k="Routed path">BRouter or Valhalla, hiking, bike or vehicle, instead of a straight line.</Li>
          <Li k="Docked">the chart moves under the map, phone-friendly: tap, tap, profile.</Li>
          <Li k="Reference">absolute, or height above the LRM neighbourhood mean.</Li>
          <Li k="Plane slicer">paints the terrain above or below one altitude.</Li>
        </Bullets>
      }
      right={<Shot src={pickerFull} caption="Line profile + plane slicer at 3,023 m, Matterhorn" width={940} height={600} />}
    />
  </Frame>
);

const P3Draw: Page = () => (
  <Frame eyebrow="Drawing" title="Sketch, import, iterate">
    <TwoCol
      leftWidth={760}
      left={
        <Bullets size={29}>
          <Li k="TerraDraw">point, line, polygon, rectangle, circle; Esc back to select.</Li>
          <Li k="Named layers">visibility, style, zoom-to-bounds; GeoJSON, KML, GPX, FlatGeobuf, Shapefile in and out.</Li>
          <Li k="In the link">?drawingUrl=https://host/features.geojson, re-fetched on every load.</Li>
          <Li k="Persistence">session by default, OPFS when you ask.</Li>
          <Li k="Feature iterator">the loop toggle frames each feature in turn: → or N, ←, D to delete. Review an inventory of sites one by one.</Li>
          <Li k="Batch targets">drawn features become per-feature export extents in Historical mode.</Li>
        </Bullets>
      }
      right={<Shot src={draw} caption="An imported GeoJSON layer of world heritage boundaries beside a hand-drawn point layer" width={940} height={600} />}
    />
  </Frame>
);

const P4Sun: Page = () => (
  <Frame eyebrow="Sun and shadow calculator" title="Give it a shadow, it gives you the time">
    <div style={{ display: 'flex', gap: 40 }}>
      <Shot src={sunReverse} caption="Reverse: Tour Montparnasse, 210 m, a 222 m shadow → 30 March, 13:00" width={880} height={450} position="center" />
      <Shot src={sunDatetime} caption="Forward: date and time sliders bound to the light pad" width={780} height={450} position="center" />
    </div>
    <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
      <Card title="Forward">A date, a time and a height: the shadow is drawn base to tip from the real sun position.</Card>
      <Card title="Reverse">Base, tip and height: azimuth from the bearing, altitude = atan2(height, length), then back to a day and an hour.</Card>
      <Card title="One light" accent={teal}>Writes illuminationDir / illuminationAlt: hillshade, Phong and cast shadows snap to it. Two candidate days per year.</Card>
    </div>
  </Frame>
);

const P5Georef: Page = () => (
  <Frame eyebrow="Image georeferencer" title="A plain image, placed from control points">
    <TwoCol
      leftWidth={900}
      left={
        <Bullets size={29}>
          <Li k="Any image">a figure from a paper, a scanned plan, a drone JPEG: from disk or a URL, in a floating window.</Li>
          <Li k="Pairs">the n-th image click pairs with the n-th map click; both draggable afterwards.</Li>
          <Li k="Fits">Allmaps transform library: similarity (2 points), affine (3), projective (4), polynomial, thin-plate spline.</Li>
          <Li k="Residuals">in metres per point once over-determined.</Li>
          <Li k="Drawn under the relief">hillshade and contours read through it.</Li>
          <Li k="World file">.pgw / .jgw + .prj for QGIS or GDAL; points and fit travel in the link.</Li>
        </Bullets>
      }
      right={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Code size={23}>{`georefGcps=…   georefType=projective
georefImage=https://host/figure.jpg`}</Code>
          <Card title="Rule of thumb" accent={teal}>Similarity for a map figure. Projective for a photo of a flat map taken at an angle.</Card>
        </div>
      }
    />
  </Frame>
);

const P6Anim: Page = () => (
  <Frame eyebrow="Animation" title="Keyframes, a flight, a rendered fly-through">
    <TwoCol
      leftWidth={1000}
      left={
        <Bullets>
          <Li k="Keyframes">camera poses, interpolated.</Li>
          <Li k="Scrub">preview the path before rendering.</Li>
          <Li k="Export">a rendered fly-through video.</Li>
          <Li k="Terrain mode only">Historical mode has no continuous surface to fly over.</Li>
          <Li k="Hillshade direction">the light pad can be animated the same way.</Li>
        </Bullets>
      }
      right={<Shot src={animation} caption="The Animation panel" width={420} height={600} fit="contain" />}
    />
  </Frame>
);

const P7Stac: Page = () => (
  <Frame eyebrow="STAC search" title="Find scenes over the view, add the COG, no download">
    <TwoCol
      leftWidth={860}
      left={
        <>
          <Row k="Mixed" v="OpenAerialMap, Earth Search (Element 84), eoAPI, NASA VEDA, swisstopo" />
          <Row k="Imagery" v="LINZ, Maxar and Vantor open data, Planet disaster, Umbra and Capella SAR, Lower Saxony, SPOT Canada" />
          <Row k="Elevation" v="OpenTopography rasters, LINZ elevation, PGC ArcticDEM, REMA, EarthDEM" />
          <Row k="Registries" v="federated collection discovery (MAAP); or paste any API or static catalog.json" />
          <div style={{ marginTop: 26 }}>
            <Bullets size={26}>
              <Li k="API">paged /search with bbox and datetime. <b style={{ color: '#fff' }}>Static:</b> child links crawled breadth-first.</Li>
              <Li k="Web Mercator first">other projections pinned to titiler; terrain filtered to single-band rasters.</Li>
            </Bullets>
          </div>
        </>
      }
      right={<Shot src={stacCatalogs} caption="17 presets, grouped; a tab in Add Terrain and Add Basemap" width={840} height={620} />}
    />
  </Frame>
);

const P8Byod: Page = () => (
  <Frame eyebrow="Bring your own data" title="Every shape a browser can read">
    <TwoCol
      leftWidth={840}
      left={
        <Bullets size={27}>
          <Li k="XYZ tiles">Terrarium or Terrain-RGB, custom RGB factors (Mexico's baseShift 1000).</Li>
          <Li k="COG">in-browser range reads (geomatico), or titiler when not in EPSG:3857.</Li>
          <Li k="WMS / WCS float32">a GeoTIFF per tile, re-encoded in the browser (float32dem://).</Li>
          <Li k="ArcGIS ImageServer">exportImage tiff, or LERC tiles (lerc://).</Li>
          <Li k="VRT mosaics · quantized mesh · PMTiles">vrt://, quantized-mesh://, pmtiles://.</Li>
          <Li k="IIIF + Allmaps annotation">an old map warped on the GPU, always an overlay.</Li>
          <Li k="Local COG">a blob: URL off your disk, OPFS-persisted on request; never uploaded.</Li>
          <Li k="Registries">QMS and the OSM Editor Layer Index, filtered to the view, licence carried over.</Li>
        </Bullets>
      }
      right={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Shot src={byodAdd} caption="Add New Terrain Dataset" width={860} height={470} />
          <Code size={21}>{`gdalwarp -t_srs EPSG:3857 -of COG src.tif out.tif
npx serve --cors -p 8080 .   # localhost is exempt from mixed content`}</Code>
        </div>
      }
    />
  </Frame>
);

const P9Diff: Page = () => (
  <Frame eyebrow="Derived terrain" title="The difference of two sources, tile by tile">
    <TwoCol
      leftWidth={780}
      left={
        <>
          <Bullets size={28}>
            <Li k="nDSM = DSM − DTM">height of what stands on the ground; IGN and AHN pairs ship ready-made, 0.5 m.</Li>
            <Li k="Change">same model, two dates: erosion negative, deposition positive. Bhotekoshi 2026 DSM minus GLO-30.</Li>
            <Li k="Any operands">COG, tiles, WMS, titiler; the coarser one upsampled from its nearest ancestor tile.</Li>
            <Li k="Vertical offset">sample a stable spot on both and move the zero back.</Li>
          </Bullets>
          <div style={{ display: 'flex', gap: 20, marginTop: 28 }}>
            <Card title="Datum">ellipsoid vs geoid: tens of metres.</Card>
            <Card title="Resolution">a 30 m reference floats above a gorge floor.</Card>
            <Card title="Co-registration">paired stripes along ridges.</Card>
          </div>
        </>
      }
      right={<Shot src={byodDiff} caption="Edit Terrain Dataset for a difference source, over a symmetric hypsometric ramp" width={900} height={600} />}
    />
  </Frame>
);

const P10Iso: Page = () => (
  <Frame eyebrow="Iso-line and contours" title="One line where a measure crosses a value">
    <TwoCol
      leftWidth={760}
      left={
        <Bullets size={29}>
          <Li k="Contours">minor and major interval, maplibre-contour; reference absolute or LRM.</Li>
          <Li k="Iso-line">elevation (a lake level, canopy at 1.5 m on an nDSM) or slope in degrees (30° avalanche terrain, 80° cliffs).</Li>
          <Li k="Fill above">a raster from the same threshold:// tiles, so no seams.</Li>
          <Li k="Horn kernel">iso-slope traced over the padded grid.</Li>
          <Li k="Export">GeoJSON, segments stitched across tile edges.</Li>
          <Li k="Graticule">lat/lng grid with labels.</Li>
        </Bullets>
      }
      right={<Shot src={contours} caption="Contours + GeoGrid, 10 m minor, 100 m major" width={940} height={600} />}
    />
  </Frame>
);

const P11Buildings: Page = () => (
  <Frame eyebrow="Building shadows" title="OSM footprints swept from the sun, on the GPU">
    <TwoCol
      leftWidth={760}
      left={
        <Bullets size={29}>
          <Li k="Source">OpenFreeMap's building layer, OSM height or levels, read once per settled view from z13.</Li>
          <Li k="Sweep">each footprint extruded away from the sun by height / tan(altitude).</Li>
          <Li k="Mask">drawn once as a union: overlaps never darken twice, roofs stay lit.</Li>
          <Li k="Live">the light is two uniforms; moving the sun slider is a repaint.</Li>
          <Li k="Flat ground">Mercator only; for a spire on a slope use terrain shadows with a DSM.</Li>
        </Bullets>
      }
      right={<Shot src={buildingShadows} caption="showBuildingShadows=true" width={940} height={600} />}
    />
  </Frame>
);

const P12Export: Page = () => (
  <Frame eyebrow="Export" title="Snapshot, DEM, every layer, raw or coloured">
    <TwoCol
      leftWidth={760}
      left={
        <>
          <Bullets size={27}>
            <Li k="Snapshot">JPEG as laid out, every view of a split; a .jgw world file in 2D.</Li>
            <Li k="DEM GeoTIFF">float32 WGS 84, client-side mosaic or titiler /cog/bbox.</Li>
            <Li k="Visible layers">one file per line: DEM, basemap, hillshade, hypso, each mode's raw values (NaN nodata) or coloured, contours as GeoJSON.</Li>
            <Li k="Size">screen pixels in seconds, or a custom longest edge up to 16,384 px.</Li>
            <Li k="Grid">everything EPSG:3857, so files line up without resampling.</Li>
          </Bullets>
          <div style={{ marginTop: 22 }}>
            <Shot src={downloadSection} width={760} height={150} position="center" />
          </div>
        </>
      }
      right={<Shot src={exportLayers} caption="Export layers: Visible and Not visible trees, Export 4" width={900} height={620} />}
    />
  </Frame>
);

const P13Embed: Page = () => (
  <Frame eyebrow="Embedding" title="An iframe is the link in a src">
    <TwoCol
      leftWidth={860}
      left={
        <>
          <Code size={21}>{`<iframe src="https://terrain-viewer.iconem.com/?terrainSourceA=https://host/dem.tif
  &viewMode=3d&showHillshade=true&sidebarCollapsed=true
  &drawingUrl=https%3A%2F%2Fhost%2Fsites.geojson" width="100%" height="480" />`}</Code>
          <div style={{ marginTop: 24 }}>
            <Bullets size={26}>
              <Li k="Select a source">terrainSourceA…H, basemapSourceA…H, a URL or a library id.</Li>
              <Li k="Make it available">addSources, addTerrainUrl, addBasemapUrl, addOverlayUrl.</Li>
              <Li k="Instructions">project=&lt;preset&gt;, openSections, scrollTo, startTour, bookmarksUrl, openLibrary.</Li>
              <Li k="Open In">hands the viewport to River-REM, Wayback, Google Earth and more.</Li>
            </Bullets>
          </div>
        </>
      }
      right={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Shot src={embedHost} caption="A blog post with the app in the middle of its text" width={840} height={360} />
          <Shot src={openIn} caption="The Open In launcher" width={840} height={240} position="center" />
        </div>
      }
    />
  </Frame>
);

const P14Close: Page = () => (
  <Closing
    title={
      <>
        Click twice.
        <br />
        <span style={{ color: 'var(--osd-accent)' }}>Read the profile.</span>
      </>
    }
    lines={[
      'terrain-viewer.iconem.com/docs/features/tools',
      'terrain-viewer.iconem.com/docs/features/byod',
      'terrain-viewer.iconem.com/docs/features/export-and-share',
      'terrain-viewer.iconem.com/docs/features/embedding',
    ]}
  />
);

export const notes: (string | undefined)[] = [
  'The Tools group and the dialogs around it: the parts of the app that are not a visualization mode.',
  'The elevation picker is seven tools under one toggle. Two clicks give a profile; the chart docks under the map on a phone.',
  'Drawing layers import most vector formats. The iterator frames features one by one with the arrow keys.',
  'The sun calculator runs the astronomy backwards: a shadow, a height, and you get a date and time.',
  'A plain image placed from control points, with the Allmaps transforms. Download a world file for QGIS.',
  'Animation flies keyframes and renders a video. Terrain mode only.',
  'STAC search: seventeen catalogs plus any URL. Scenes become sources without downloading.',
  'Bring your own data: tiles, COGs, WMS, ArcGIS, VRT, quantized mesh, IIIF maps, local files.',
  'Subtract two sources: a normalised DSM, or change between two surveys. Mind the datum.',
  'Contours trace elevation or the LRM. The iso-line traces one value of elevation or slope and can fill above it.',
  'Building shadows are a GPU mask over OSM footprints. The sun slider is live.',
  'Export the DEM, or every layer, raw values or coloured, on the same Web Mercator grid.',
  'Embedding is the same link in an iframe. Presets and instruction parameters keep it short.',
  'Try the profile first.',
];

export const meta: SlideMeta = {
  title: 'Tools',
  createdAt: '2026-10-05T13:22:28.903Z',
};

export default [
  P1Cover,
  P2Picker,
  P3Draw,
  P4Sun,
  P5Georef,
  P6Anim,
  P7Stac,
  P8Byod,
  P9Diff,
  P10Iso,
  P11Buildings,
  P12Export,
  P13Embed,
  P14Close,
] satisfies Page[];
