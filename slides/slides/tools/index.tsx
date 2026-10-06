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
// The look of open-slide's stock getting-started deck: white, Geist, hairline
// rules, soft panels, one restrained accent (HeritageWatch AI blue).

export const design: DesignSystem = {
  palette: { bg: '#ffffff', text: '#0a0a0a', accent: '#1A237E' },
  fonts: {
    display:
      '"Geist Variable", Geist, -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
    body: '"Geist Variable", Geist, -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
  },
  typeScale: { hero: 152, body: 32 },
  radius: 12,
};

const DECK = 'Tools';
const FOOT = 'terrain viewer · tools · terrain-viewer.iconem.com';

const ink = {
  text: '#0a0a0a',
  soft: '#404040',
  muted: '#6b6b6b',
  dim: '#a3a3a3',
  rule: '#e4e4e4',
  hairline: '#ececec',
  panel: '#f7f7f7',
  muted2: '#efefef',
  accent: '#1A237E',
  accentLight: '#3F51B5',
  accentSoft: 'rgba(26, 35, 126, 0.08)',
  red: '#FF1D23',
  mint: '#1f9e6e',
  violet: '#7c6fcd',
};

const font = {
  sans: 'var(--osd-font-body)',
  display: 'var(--osd-font-display)',
  mono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

const shadow = {
  edge: '0 0 0 1px rgba(0, 0, 0, 0.06), 0 1px 0 rgba(0, 0, 0, 0.025)',
  window:
    '0 0 0 1px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 32px -12px rgba(0, 0, 0, 0.12)',
};

// Names the pages use.
const muted = ink.muted;
const dim = ink.dim;
const teal = ink.mint;
const rose = ink.red;
const mono = font.mono;
const pad2 = (n: number) => String(n).padStart(2, '0');

const PAD_X = 120;

const fill: CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
  overflow: 'hidden',
  background: 'var(--osd-bg)',
  color: 'var(--osd-text)',
  fontFamily: 'var(--osd-font-body)',
  letterSpacing: '-0.01em',
  WebkitFontSmoothing: 'antialiased',
};

const Mark = () => (
  <div
    style={{
      position: 'absolute',
      left: PAD_X,
      top: 101,
      width: 16,
      height: 16,
      borderRadius: 4,
      background: 'var(--osd-accent)',
    }}
  />
);

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
        fontFamily: font.mono,
        fontSize: 20,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: ink.muted,
      }}
    >
      <span>{FOOT}</span>
      <span>
        {pad2(current)} / {pad2(total)}
      </span>
    </div>
  );
};

const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      position: 'absolute',
      left: PAD_X + 28,
      top: 96,
      fontSize: 22,
      lineHeight: '26px',
      fontWeight: 500,
      color: 'var(--osd-accent)',
    }}
  >
    {children}
  </div>
);

const Frame = ({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children: ReactNode }) => (
  <div style={fill}>
    <Mark />
    <Eyebrow>{eyebrow}</Eyebrow>
    <h2
      style={{
        position: 'absolute',
        left: PAD_X,
        right: PAD_X,
        top: 138,
        margin: 0,
        fontFamily: font.display,
        fontSize: 60,
        fontWeight: 500,
        letterSpacing: '-0.03em',
        lineHeight: 1.06,
        whiteSpace: 'nowrap',
      }}
    >
      {title}
    </h2>
    <div style={{ position: 'absolute', left: PAD_X, right: PAD_X, top: 250, bottom: 84 }}>{children}</div>
    <Footer />
  </div>
);

const Bullets = ({ children, size = 28 }: { children: ReactNode; size?: number }) => (
  <ul
    style={{
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      fontSize: size,
      lineHeight: 1.38,
      borderBottom: `1px solid ${ink.rule}`,
    }}
  >
    {children}
  </ul>
);

const Li = ({ children, k }: { children: ReactNode; k?: ReactNode }) => (
  <li style={{ padding: '11px 0', borderTop: `1px solid ${ink.rule}` }}>
    {k ? <span style={{ fontWeight: 500, color: ink.text }}>{k} </span> : null}
    <span style={{ color: k ? ink.soft : ink.text }}>{children}</span>
  </li>
);

const Shot = ({
  src,
  caption,
  width = 900,
  height,
  // The frame is filled from the right edge, so the side panel and its
  // padding stay in a crop; a 16:9 frame shows a screenshot whole.
  fit = 'cover',
  position = '100% 50%',
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
        borderRadius: 12,
        boxShadow: shadow.window,
        display: 'block',
        background: ink.panel,
      }}
    />
    {caption ? (
      <figcaption style={{ fontSize: 20, color: ink.muted, marginTop: 14, lineHeight: 1.35 }}>{caption}</figcaption>
    ) : null}
  </figure>
);

const TwoCol = ({ left, right, leftWidth = 740 }: { left: ReactNode; right: ReactNode; leftWidth?: number }) => (
  <div style={{ display: 'flex', gap: 48, alignItems: 'flex-start' }}>
    <div style={{ width: leftWidth, flex: 'none' }}>{left}</div>
    <div style={{ flex: 1, minWidth: 0 }}>{right}</div>
  </div>
);

const Tile = ({ src, label, sub }: { src: string; label: string; sub?: string }) => (
  <div style={{ width: 390 }}>
    <img
      src={src}
      style={{ width: 390, height: 196, objectFit: 'cover', objectPosition: '100% 50%', borderRadius: 10, boxShadow: shadow.edge, display: 'block' }}
    />
    <div style={{ marginTop: 10, fontSize: 22, fontWeight: 500, lineHeight: 1.2 }}>
      {label} {sub ? <span style={{ color: ink.muted, fontWeight: 400, fontSize: 19 }}>{sub}</span> : null}
    </div>
  </div>
);

const Card = ({ title, children, accent = 'var(--osd-accent)' }: { title: ReactNode; children: ReactNode; accent?: string }) => (
  <div style={{ background: ink.panel, borderRadius: 12, padding: '24px 28px', flex: 1, minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 10 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: accent, flex: 'none' }} />
      <span>{title}</span>
    </div>
    <div style={{ fontSize: 22, lineHeight: 1.42, color: ink.soft }}>{children}</div>
  </div>
);

const Code = ({ children, size = 22 }: { children: ReactNode; size?: number }) => (
  <pre
    style={{
      margin: 0,
      fontFamily: font.mono,
      fontSize: size,
      lineHeight: 1.5,
      background: ink.panel,
      borderRadius: 12,
      padding: '20px 26px',
      color: ink.soft,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}
  >
    {children}
  </pre>
);

const Row = ({ k, v }: { k: ReactNode; v: ReactNode }) => (
  <div style={{ display: 'flex', gap: 24, padding: '12px 0', borderTop: `1px solid ${ink.rule}`, fontSize: 23, lineHeight: 1.35 }}>
    <span style={{ width: 190, flex: 'none', fontWeight: 500, color: ink.text }}>{k}</span>
    <span style={{ color: ink.soft }}>{v}</span>
  </div>
);

const Stat = ({ n, label }: { n: ReactNode; label: ReactNode }) => (
  <div style={{ flex: 1, minWidth: 0, borderTop: `1px solid ${ink.rule}`, paddingTop: 20 }}>
    <div style={{ fontSize: 56, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, color: ink.text }}>{n}</div>
    <div style={{ marginTop: 12, fontSize: 20, color: ink.muted, lineHeight: 1.3 }}>{label}</div>
  </div>
);

const Ref = ({ who, year, what, where }: { who: string; year: string; what: string; where: string }) => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'baseline', padding: '9px 0', borderTop: `1px solid ${ink.rule}`, fontSize: 21, lineHeight: 1.3 }}>
    <span style={{ fontFamily: font.mono, fontSize: 18, color: 'var(--osd-accent)', flex: 'none', width: 60 }}>{year}</span>
    <span>
      <span style={{ fontWeight: 500, color: ink.text }}>{who}</span> <span style={{ color: ink.soft }}>{what}</span>{' '}
      <span style={{ color: ink.dim }}>· {where}</span>
    </span>
  </div>
);

const Formula = ({ label, children }: { label?: ReactNode; children: ReactNode }) => (
  <div style={{ marginBottom: 18 }}>
    {label ? (
      <div style={{ fontFamily: font.mono, fontSize: 17, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--osd-accent)', marginBottom: 8 }}>
        {label}
      </div>
    ) : null}
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 25,
        background: ink.panel,
        borderRadius: 12,
        padding: '14px 22px',
        color: ink.text,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      }}
    >
      {children}
    </div>
  </div>
);

const Scheme = ({ s, what, accent = 'var(--osd-accent)' }: { s: string; what: ReactNode; accent?: string }) => (
  <div style={{ display: 'flex', gap: 22, alignItems: 'baseline', padding: '9px 0', borderTop: `1px solid ${ink.rule}` }}>
    <span style={{ fontFamily: font.mono, fontSize: 22, color: accent, width: 330, flex: 'none' }}>{s}</span>
    <span style={{ fontSize: 22, color: ink.soft, lineHeight: 1.3 }}>{what}</span>
  </div>
);

const Box = ({ children, accent = 'var(--osd-accent)', w = 300 }: { children: ReactNode; accent?: string; w?: number }) => (
  <div
    style={{
      width: w,
      flex: 'none',
      background: '#fff',
      boxShadow: shadow.edge,
      borderTop: `3px solid ${accent}`,
      borderRadius: 12,
      padding: '18px 20px',
      fontSize: 22,
      lineHeight: 1.35,
      textAlign: 'center',
    }}
  >
    {children}
  </div>
);

const Arrow = () => <div style={{ color: ink.dim, fontSize: 32, alignSelf: 'center', flex: 'none' }}>→</div>;

const Cover = ({ bg, eyebrow, title, subtitle }: { bg: string; eyebrow: string; title: ReactNode; subtitle: ReactNode }) => (
  <div style={fill}>
    <Mark />
    <Eyebrow>{eyebrow}</Eyebrow>
    <div style={{ position: 'absolute', left: PAD_X, top: 300, width: 900 }}>
      <h1
        style={{
          fontFamily: font.display,
          fontSize: 120,
          fontWeight: 500,
          letterSpacing: '-0.04em',
          lineHeight: 1,
          margin: 0,
        }}
      >
        {title}
      </h1>
      <p style={{ fontSize: 30, color: ink.soft, margin: '40px 0 0', maxWidth: 820, lineHeight: 1.45 }}>{subtitle}</p>
    </div>
    <img
      src={bg}
      style={{
        position: 'absolute',
        left: 1120,
        top: 200,
        width: 680,
        height: 640,
        objectFit: 'cover',
        objectPosition: '100% 50%',
        borderRadius: 12,
        boxShadow: shadow.window,
        display: 'block',
        background: ink.panel,
      }}
    />
    <Footer />
  </div>
);

const Closing = ({ title, lines }: { title: ReactNode; lines: ReactNode[] }) => (
  <div style={fill}>
    <Mark />
    <Eyebrow>{DECK}</Eyebrow>
    <h1
      style={{
        position: 'absolute',
        left: PAD_X,
        top: 220,
        margin: 0,
        fontFamily: font.display,
        fontSize: 120,
        fontWeight: 500,
        letterSpacing: '-0.04em',
        lineHeight: 1,
      }}
    >
      {title}
    </h1>
    <div style={{ position: 'absolute', left: PAD_X, right: PAD_X, top: 560, borderBottom: `1px solid ${ink.rule}` }}>
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 40,
            alignItems: 'baseline',
            padding: '18px 0',
            borderTop: `1px solid ${ink.rule}`,
            fontFamily: font.mono,
            fontSize: 26,
            color: ink.soft,
          }}
        >
          <span style={{ fontSize: 20, color: 'var(--osd-accent)', letterSpacing: '0.08em' }}>{pad2(i + 1)}</span>
          <span>{l}</span>
        </div>
      ))}
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
              <Li k="API">paged /search with bbox and datetime. <b style={{ color: ink.text, fontWeight: 500 }}>Static:</b> child links crawled breadth-first.</Li>
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
          <Li k="Iso-line">over any measure: the elevation (a lake level, canopy at 1.5 m on an nDSM), slope (30° avalanche terrain, 80° cliffs) and every terrain-analysis and relief mode, or a light's brightness (Phong, Matcap, shadow) through luma://.</Li>
          <Li k="At a value, or every interval">one line where the measure crosses the value, or the contours of the measure itself (slope every 10°, a curvature every 1).</Li>
          <Li k="Fill above">the polygons whose boundary is the line (isoband://), so the fill stops exactly on it.</Li>
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
  "Contours trace elevation or the LRM. The iso-line traces any measure: elevation, slope, every derived mode or a light's brightness, at one value or every interval, and can fill above it.",
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
