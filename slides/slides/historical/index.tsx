import { type DesignSystem, type Page, type SlideMeta, useSlidePageNumber } from '@open-slide/core';
import type { CSSProperties, ReactNode } from 'react';

import heroGrid from '@assets/screenshots/overview-historical-grid-2x2.jpg';
import timeline from '@assets/screenshots/historical-timeline.jpg';
import timelineWalk from '@assets/screenshots/walkthrough/historical/11-historical-timeline.jpg';
import histTools from '@assets/screenshots/walkthrough/historical/12-historical-tools.jpg';
import stacSearch from '@assets/screenshots/stac-search.jpg';
import coverage from '@assets/screenshots/coverage-overlays.jpg';
import coverage3d from '@assets/screenshots/coverage-3d-lidar-europe.jpg';
import grid42 from '@assets/screenshots/split-modes/historical-grid-4x2.jpg';
import blendDiff from '@assets/screenshots/split-modes/blend-difference-100.jpg';
import matchOn from '@assets/screenshots/split-modes/match-colors-on.jpg';
import matchOff from '@assets/screenshots/split-modes/match-colors-off.jpg';
import exportHist from '@assets/screenshots/export-share/export-historical-dialog.jpg';
import osm3d from '@assets/screenshots/osm-liberty-3d.jpg';

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

const DECK = 'Historical imagery';
const muted = '#93a4bd';
const dim = '#5f6f88';
const teal = '#4fd1c5';
const rose = '#f472b6';
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
        <span style={{ color: 'var(--osd-accent)' }}>▲</span> Terrain Viewer · {DECK} · historical-satellite.iconem.com
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

const Stat = ({ n, label }: { n: ReactNode; label: ReactNode }) => (
  <div style={{ flex: 1, background: panel, border: `1px solid ${rule}`, borderRadius: 'var(--osd-radius)', padding: '24px 28px' }}>
    <div style={{ fontFamily: mono, fontSize: 56, fontWeight: 700, color: 'var(--osd-accent)', lineHeight: 1.05 }}>{n}</div>
    <div style={{ fontSize: 23, color: muted, marginTop: 10, lineHeight: 1.35 }}>{label}</div>
  </div>
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
      historical-satellite.iconem.com · terrain-viewer.iconem.com/?appMode=historical
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
    bg={heroGrid}
    eyebrow="Historical imagery"
    title={
      <>
        One timeline,
        <br />
        every archive
      </>
    }
    subtitle="Satellite, aerial and old-map archives that answer a browser, scrubbed by date, compared side by side."
  />
);

const P2Providers: Page = () => (
  <Frame eyebrow="Providers" title="The timeline's own sources">
    <TwoCol
      leftWidth={860}
      left={
        <Bullets size={28}>
          <Li k="ESRI Wayback">dated releases of World Imagery since 2014; release, mosaic and per-tile capture date are three different dates.</Li>
          <Li k="Google Earth Historical">gehist://, a reverse-engineered quadtree (Iconem GE_TimeMachine); dates live inside each tile, often back to the early 2000s.</Li>
          <Li k="Bing Aerial">one current capture, no archive.</Li>
          <Li k="Planet monthly mosaics">with an API key.</Li>
          <Li k="NASA HLS · Sentinel-2 · Landsat WELD 1983-2000">medium resolution, behind the Medium res pill.</Li>
        </Bullets>
      }
      right={<Shot src={timeline} caption="The timeline panel under the map" width={840} height={560} />}
    />
  </Frame>
);

const P3Timeline: Page = () => (
  <Frame eyebrow="Timeline panel" title="A handle per view, a tick per capture">
    <TwoCol
      leftWidth={720}
      left={
        <Bullets size={29}>
          <Li k="Ticks">one per real capture at the view's centre, in the source's colour.</Li>
          <Li k="Handles">one per view A to H, dragged to a date; the view's basemap follows.</Li>
          <Li k="Pills">toggle providers; VHR by default, Medium res on demand.</Li>
          <Li k="Zoom">wheel zooms the track around the cursor, a gutter below pans the window.</Li>
          <Li k="Catalogs">the button after the pills opens the tree on the next slides.</Li>
          <Li k="Date pill">on each view: source and capture date, as shown in snapshots.</Li>
        </Bullets>
      }
      right={<Shot src={timelineWalk} caption="Scrubbing capture dates across providers" width={980} height={600} />}
    />
  </Frame>
);

const P4Tree: Page = () => (
  <Frame eyebrow="Catalogs" title="Four root groups, queried per view">
    <div style={{ display: 'flex', gap: 24 }}>
      <Card title="Post-crisis open data" accent={rose}>OpenAerialMap · Maxar Open Data · Vantor Open Data · NOAA Emergency Response · Planet disaster data</Card>
      <Card title="Community indexes" accent={teal}>OSM Editor Layer Index · NextGIS QMS · ArcGIS Online · CORONA Atlas (CAST)</Card>
      <Card title="National catalogs">IGN Remonter le temps · swisstopo · Kartverket · about 70 national, regional and city archives</Card>
      <Card title="Old maps, warped" accent="#a78bfa">Allmaps · Map Warper · Wikimaps Warper · SLUB Kartenforum · USGS historical topo</Card>
    </div>
    <div style={{ display: 'flex', gap: 24, marginTop: 34 }}>
      <Stat n="69" label="national sources added, about 1,502 dated layers" />
      <Stat n="~1,300" label="ELI layers with a capture date, 1840s to today" />
      <Stat n="~9,000" label="SLUB georeferenced old maps of Germany" />
      <Stat n="279" label="CORONA KH-4 mosaics, 1963-72, Middle East" />
      <Stat n="~57,000" label="David Rumsey maps, through Allmaps" />
    </div>
    <p style={{ fontSize: 25, color: muted, marginTop: 30, lineHeight: 1.4 }}>
      Every checked catalog is asked for the view as the camera settles; its items become ticks. Selection travels in the link: <span style={{ fontFamily: mono, color: 'var(--osd-text)' }}>timelineCatalogs</span>.
    </p>
  </Frame>
);

const P5Crisis: Page = () => (
  <Frame eyebrow="Open data for post-crisis response" title="STAC searches, COGs drawn through TiTiler">
    <TwoCol
      leftWidth={800}
      left={
        <Bullets size={29}>
          <Li k="HOT STAC">api.imagery.hotosm.org/stac, searched with the view's bbox: OpenAerialMap, Maxar, Vantor, NOAA.</Li>
          <Li k="One tick per acquisition">items of one date and flight grouped; the tile under the centre is drawn.</Li>
          <Li k="Planet disaster data">a static STAC on source.coop, no search API: a session index of every extent, about 10 s, then filtered.</Li>
          <Li k="Within the timeline window">passes the window to the STAC datetime filter.</Li>
          <Li k="Any STAC">a custom catalog on the timeline is the planned extension of the same mechanism.</Li>
        </Bullets>
      }
      right={<Shot src={stacSearch} caption="Vantor open data over the 2026 Nepal flooding, each scene addable as basemap or overlay" width={900} height={600} />}
    />
  </Frame>
);

const P6Indexes: Page = () => (
  <Frame eyebrow="Community indexes" title="The registries OSM editors already keep">
    <TwoCol
      leftWidth={820}
      left={
        <Bullets size={28}>
          <Li k="OSM Editor Layer Index">~1,500 agency services with licence recorded, bundled and bumped weekly; a tick for every dated layer whose real polygon touches the view.</Li>
          <Li k="NextGIS QMS">TMS and WMS services whose declared extent touches the view, as footprints.</Li>
          <Li k="ArcGIS Online">public image and map services found by bbox, sized to the view, dated from title or tags.</Li>
          <Li k="CORONA Atlas">CAST's GeoServer, block index baked in since the list sends no CORS header.</Li>
          <Li k="Coverage first">the same index entries draw as outlines before loading, with hover and click lists.</Li>
        </Bullets>
      }
      right={<Shot src={coverage} caption="Mapterhorn, library bounds and ELI footprints over Europe, with the hover list" width={880} height={600} />}
    />
  </Frame>
);

const P7National: Page = () => (
  <Frame eyebrow="National catalogs" title="About seventy archives, one sub-heading per country">
    <div style={{ display: 'flex', gap: 60 }}>
      <div style={{ flex: 1 }}>
        <Row k="France" v="IGN: Cassini 1756-1815, État-major 1820-66, 1950-65 mosaic, every yearly ortho since 2000, SPOT, Pléiades; CRAIG, DataGrandEst" />
        <Row k="Switzerland" v="SWISSIMAGE since 1926; Dufour, Siegfried, Landeskarte since 1844; Basel 1615-, Zürich, Geneva" />
        <Row k="Germany" v="NRW 1951-2024 (73), Baden-Württemberg 1960-, Bavaria, Berlin 1953-, Hamburg, Saxony 1922-" />
        <Row k="Spain" v="PNOA histórico 1956-, Madrid 1927-2009 (186 layers), Catalonia, Basque Country, Navarre 1929-" />
        <Row k="Austria · Belgium" v="Vienna 1938-, Tyrol 1940-, Vorarlberg 1930-; NGI maps 1869-1994 (110), Flanders 1571-" />
      </div>
      <div style={{ flex: 1 }}>
        <Row k="Norway" v="Kartverket Amtskart 1826-1916" />
        <Row k="Italy" v="Lombardy GAI 1954, Tuscany 1954-, Piedmont 1852-, South Tyrol 1858-, Sardinia 1940-" />
        <Row k="North America" v="NYC 1924-, Washington DC 1791-, Toronto 1931-, Ottawa 1928-, Seattle 1936-, Iowa by decade" />
        <Row k="Asia · Oceania" v="Japan GSI 1936-90, Taiwan maps 1895-, NSW 1943-2013" />
        <Row k="How" v="one tile at the centre per layer, or the agency's flight index (NRW, Bavaria, Tyrol); identical years deduplicated" />
      </div>
    </div>
  </Frame>
);

const P8OldMaps: Page = () => (
  <Frame eyebrow="Old maps, digitised and warped" title="Scanned sheets, placed from their control points">
    <TwoCol
      leftWidth={900}
      left={
        <Bullets size={28}>
          <Li k="Allmaps">IIIF maps with a Georeference Annotation, warped on the GPU from control points and mask; Leiden, TU Delft, BnF, Leventhal, Internet Archive, David Rumsey.</Li>
          <Li k="Map Warper · Wikimaps Warper">rectified maps by bbox, a tick at 1 January of the depicted year.</Li>
          <Li k="SLUB Kartenforum">Messtischblätter, topographic maps, city plans, by publication year.</Li>
          <Li k="USGS historical topo">every edition of every quad since 1884, from Esri's image service.</Li>
          <Li k="Not reachable from a browser">Old Maps Online, Library of Congress, Rumsey MapRank: no CORS, Cloudflare. Their maps arrive through Allmaps instead.</Li>
        </Bullets>
      }
      right={<Shot src={osm3d} caption="OSM 3D buildings over a Vantor post-event overlay, Nepal" width={800} height={600} />}
    />
  </Frame>
);

const P9TickCard: Page = () => (
  <Frame eyebrow="Ticks" title="Hover a tick: the card">
    <TwoCol
      leftWidth={760}
      left={
        <Bullets size={29}>
          <Li k="Source and date">first: "ELI 2020", "OAM 2023-04-18".</Li>
          <Li k="Item">name, catalog, resolution and licence when the catalog states them.</Li>
          <Li k="Thumbnail">where one exists: OpenAerialMap, Maxar, Vantor, NOAA, Planet, SLUB.</Li>
          <Li k="Put it on a view">as basemap or as overlay, on any visible view.</Li>
          <Li k="Keep">among your own sources; otherwise a picked item is transient.</Li>
          <Li k="Footprints on the map">every item found, a faint outline in its catalog's colour; a small item framed.</Li>
        </Bullets>
      }
      right={<Shot src={histTools} caption="Historical mode tools: timeline, catalogs, per-view sources" width={920} height={580} />}
    />
  </Frame>
);

const P10Compare: Page = () => (
  <Frame eyebrow="Compare" title="Grid, blend, match">
    <div style={{ display: 'flex', gap: 28 }}>
      <Shot src={grid42} caption="4×2: eight views, Wayback and Google Earth across dates, Île de la Cité" width={760} height={400} />
      <Shot src={blendDiff} caption="Overlay, Difference blend: 2021 against 2015" width={420} height={400} position="center" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Shot src={matchOff} caption="Match colors off" width={440} height={190} position="center" />
        <Shot src={matchOn} caption="Match colors on: B, C, D recoloured onto A's histogram" width={440} height={190} position="center" />
      </div>
    </div>
    <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
      <Card title="Side">Any grid to 4×2. A source, a date and a border colour per view; click a row label to set all views.</Card>
      <Card title="Overlay">Wipe gutter and opacity on the map; Normal, Multiply, Difference.</Card>
      <Card title="Match colors" accent={teal}>Per-channel CDF matching as a live SVG feComponentTransfer filter; HSL, HSV, LAB, LCH as a per-pixel LUT.</Card>
    </div>
  </Frame>
);

const P11Coverage: Page = () => (
  <Frame eyebrow="Coverage overlays" title="Where is there data, before loading it">
    <TwoCol
      leftWidth={760}
      left={
        <Bullets size={28}>
          <Li k="Terrain">Mapterhorn's per-country polygons, the library's bounds, your sources.</Li>
          <Li k="3D and LiDAR">Bing Maps 3D (from its own subtree availability), Google photorealistic 3D (its coverage layer, decoded), Esri Integrated Mesh (1,719 of 10,900 services), FLAI open LiDAR (114 COPC footprints), OpenTopography.</Li>
          <Li k="Basemaps">ELI polygons, the basemap library, your basemaps, and the whole historical catalogs tree.</Li>
          <Li k="Reading it">hover lists what covers a point, click ranks by intersection over union, finest first.</Li>
          <Li k="In the link">coverageOverlays=mapterhorn,library</Li>
        </Bullets>
      }
      right={<Shot src={coverage3d} caption="Bing (indigo), Google (rose), Esri mesh (violet), FLAI (teal) over Europe" width={920} height={580} />}
    />
  </Frame>
);

const P12Export: Page = () => (
  <Frame eyebrow="Export" title="Batch GeoTIFFs, and the catalog itself as STAC">
    <TwoCol
      leftWidth={820}
      left={
        <>
          <Bullets size={28}>
            <Li k="Export Multi (Historical)">one RGB GeoTIFF per target × source × capture date, cropped, in one zip; per-feature targets from drawn layers.</Li>
            <Li k="gdal_translate script">a .bat per target to refetch the same extents at native resolution.</Li>
            <Li k="/docs/stac/catalog.json">8 collections: terrain-builtin, libraries, historical-imagery, eli (~1,750), ign-historical (~140), national-historical (~330), timeline-catalogs.</Li>
            <Li k="web-map-links">xyz, wms, wmts links per item; each links back to the app at its place.</Li>
          </Bullets>
          <div style={{ marginTop: 26, fontFamily: mono, fontSize: 22, color: muted, lineHeight: 1.5 }}>
            developmentseed.org/stac-map/?href=https://terrain-viewer.iconem.com/docs/stac/catalog.json
          </div>
        </>
      }
      right={<Shot src={exportHist} caption="48 captures from Wayback and Google Earth over Île de la Cité, one GeoTIFF each" width={880} height={600} />}
    />
  </Frame>
);

const P13Close: Page = () => (
  <Closing
    title={
      <>
        Scrub a date.
        <br />
        <span style={{ color: 'var(--osd-accent)' }}>Then eight.</span>
      </>
    }
    lines={[
      'historical-satellite.iconem.com',
      'terrain-viewer.iconem.com/docs/features/basemaps-and-historical',
      'terrain-viewer.iconem.com/docs/features/coverage-overlays',
      'github.com/Iconem/GE_TimeMachine',
    ]}
  />
);

export const notes: (string | undefined)[] = [
  'Historical mode: the same app, a stripped sidebar, and the timeline. historical-satellite.iconem.com opens straight into it.',
  'Five providers feed the timeline. Wayback is a chain of dated releases; Google Earth Historical keeps every date inside the tile itself.',
  'Each view has a handle. Drag it along the ticks and the view switches capture.',
  'Catalogs is the tree: four root groups. Every checked catalog is queried for the current view when the camera settles.',
  'The disaster-response catalogs are STAC searches; the scene under the centre is drawn through TiTiler.',
  'The Editor Layer Index is the registry iD and JOSM use. About 1,300 of its layers carry a date.',
  'About seventy national and regional archives, each probed at the view centre so only real years show.',
  'Old maps come warped from their control points. The ones without CORS arrive through Allmaps.',
  'Hovering a tick shows the card: everything the catalog knows, and buttons to put the item on a view.',
  'Compare in a grid, blend with a difference, and match colours so providers agree.',
  'Coverage overlays answer "is there anything here" before loading, including 3D mesh and LiDAR footprints.',
  'Export a batch of dated GeoTIFFs, or read the whole source list as a STAC catalog.',
  'Pick a place you know and scrub.',
];

export const meta: SlideMeta = {
  title: 'Historical imagery',
  createdAt: '2026-10-05T13:22:28.903Z',
};

export default [
  P1Cover,
  P2Providers,
  P3Timeline,
  P4Tree,
  P5Crisis,
  P6Indexes,
  P7National,
  P8OldMaps,
  P9TickCard,
  P10Compare,
  P11Coverage,
  P12Export,
  P13Close,
] satisfies Page[];
