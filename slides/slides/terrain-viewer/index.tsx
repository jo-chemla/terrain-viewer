import {
  type DesignSystem,
  type Page,
  type SlideMeta,
  useSlidePageNumber,
} from '@open-slide/core';
import type { CSSProperties, ReactNode } from 'react';

import hero from '@assets/screenshots/overview-hero.jpg';
import sidebar from '@assets/screenshots/sidebar-overview.jpg';
import sourceInfo from '@assets/screenshots/terrain-source-info.jpg';
import library from '@assets/screenshots/terrain-library.jpg';
import combined from '@assets/screenshots/viz-modes/combined.jpg';
import globe from '@assets/screenshots/globe-view.jpg';
import splitCompare from '@assets/screenshots/walkthrough/terrain/15-split-compare-mode.jpg';
import modesPerView from '@assets/screenshots/walkthrough/terrain/17-modes-per-view.jpg';
import bookmarks from '@assets/screenshots/bookmarks-gallery.jpg';
import shareModal from '@assets/screenshots/export-share/share-modal.jpg';
import skillView from '@assets/screenshots/ui/ai-skill-link-view.jpg';
import tHillshade from '@assets/screenshots/thumbs/viz-modes/hillshade.jpg';
import tHypso from '@assets/screenshots/thumbs/viz-modes/hypso.jpg';
import tContours from '@assets/screenshots/thumbs/viz-modes/contours.jpg';
import tSlope from '@assets/screenshots/thumbs/viz-modes/slope.jpg';
import tCurvature from '@assets/screenshots/thumbs/viz-modes/curvature.jpg';
import tTpi from '@assets/screenshots/thumbs/viz-modes/tpi.jpg';
import tLrm from '@assets/screenshots/thumbs/viz-modes/lrm.jpg';
import tSvf from '@assets/screenshots/thumbs/viz-modes/svf.jpg';
import tOpenness from '@assets/screenshots/thumbs/viz-modes/openness.jpg';
import tPhong from '@assets/screenshots/thumbs/viz-modes/phong.jpg';
import tMatcap from '@assets/screenshots/thumbs/viz-modes/matcap.jpg';
import tShadows from '@assets/screenshots/thumbs/viz-modes/hard-shadows.jpg';

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

const DECK = 'Terrain Viewer';
const FOOT = 'terrain viewer · terrain-viewer.iconem.com';

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
      style={{ width: 390, height: 196, objectFit: 'cover', borderRadius: 10, boxShadow: shadow.edge, display: 'block' }}
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
    bg={hero}
    eyebrow="Overview"
    title={
      <>
        Terrain Viewer
      </>
    }
    subtitle="Elevation and historical imagery, rendered in the browser. No backend, no install, every view a link."
  />
);

const P2What: Page = () => (
  <Frame eyebrow="What it is" title="A map app that computes, not a map server">
    <TwoCol
      left={
        <Bullets>
          <Li k="MapLibre GL">React + TypeScript + Vite, react-map-gl.</Li>
          <Li k="Client-side only.">Tiles are fetched, decoded and derived in the browser. Nothing runs on a server.</Li>
          <Li k="URL = state.">Camera, sources, every mode: one query string, shareable as-is.</Li>
          <Li k="Two modes.">Terrain (relief, analysis, light) and Historical Imagery (a dated timeline).</Li>
          <Li k="Open source.">github.com/Iconem/terrain-viewer, built by Iconem.</Li>
        </Bullets>
      }
      right={<Shot src={sidebar} caption="The sidebar: General, Compare and Blend, Visualization Modes, Bookmarks, Sources, Tools" width={960} height={600} fit="cover" />}
    />
  </Frame>
);

const P3Sources: Page = () => (
  <Frame eyebrow="Terrain sources" title="Worldwide DEM tilesets, built in">
    <TwoCol
      leftWidth={820}
      left={
        <Bullets size={29}>
          <Li k="Mapterhorn">Terrarium · z18 · 512 px. Copernicus GLO-30 base, national LiDAR swapped in. The default.</Li>
          <Li k="AWS Terrain Tiles">Terrarium · z16. The Mapzen heritage, the one with ETOPO1 bathymetry.</Li>
          <Li k="Esri World Elevation">LERC float tiles decoded in the browser, TopoBathy: land and seafloor in one surface.</Li>
          <Li k="Mapbox Terrain-DEM · MapTiler Terrain-RGB">Terrain-RGB, API key required.</Li>
          <Li k="Encodings">Terrarium h = R·256 + G + B/256 − 32768 · Terrain-RGB h = −10000 + (R·256² + G·256 + B)·0.1</Li>
        </Bullets>
      }
      right={<Shot src={sourceInfo} caption="Source info: link, encoding, licence, a ready-to-run GDAL export command" width={880} height={560} />}
    />
  </Frame>
);

const P4National: Page = () => (
  <Frame eyebrow="National open data" title="Agency LiDAR, streamed live at native resolution">
    <TwoCol
      leftWidth={800}
      left={
        <>
          <Bullets size={29}>
            <Li k="IGN LiDAR HD">France, 0.5 m DTM and DSM, WMS float32</Li>
            <Li k="AHN">Netherlands, 0.5 m DTM and DSM</Li>
            <Li k="swisstopo swissALTI3D">one national COG, pinned to titiler</Li>
            <Li k="Kartverket">Norway, 0.25 m resampled on demand</Li>
            <Li k="Environment Agency · USGS 3DEP">England and USA, 1 m ImageServer</Li>
            <Li k="Plus">Spain, Italy, Japan, Mexico, New Zealand, ArcticDEM, REMA, GEDTM30, Digital Earth Africa…</Li>
          </Bullets>
          <div style={{ marginTop: 34, display: 'flex', gap: 24 }}>
            <Card title="153 sources" accent={teal}>Mapterhorn catalog, 32 countries, ~690,000 bulk files ingested</Card>
            <Card title="One click">Library picker, graded against Mapterhorn, coverage footprints on the map</Card>
          </div>
        </>
      }
      right={<Shot src={library} caption="Sources → Terrain → Library" width={900} height={620} />}
    />
  </Frame>
);

const P5ModesGrid: Page = () => (
  <Frame eyebrow="Visualization modes" title="Same Matterhorn, twelve ways">
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px 24px' }}>
      <Tile src={tHillshade} label="Hillshade" sub="7 methods" />
      <Tile src={tHypso} label="Elevation hypso" sub="cpt-city ramps" />
      <Tile src={tContours} label="Contours + grid" sub="+ iso-line" />
      <Tile src={tSlope} label="Slope" sub="Horn 3×3" />
      <Tile src={tCurvature} label="Curvature" sub="5 kinds" />
      <Tile src={tTpi} label="TPI" sub="TRI, roughness" />
      <Tile src={tLrm} label="LRM" sub="local relief" />
      <Tile src={tSvf} label="Sky-view factor" />
      <Tile src={tOpenness} label="Openness" sub="+ / −" />
      <Tile src={tPhong} label="Phong" sub="3 lights, fresnel" />
      <Tile src={tMatcap} label="Matcap" />
      <Tile src={tShadows} label="Hard shadows" sub="+ OSM buildings" />
    </div>
  </Frame>
);

const P6Stack: Page = () => (
  <Frame eyebrow="Visualization modes" title="Every mode stacks, each with its own opacity">
    <TwoCol
      leftWidth={760}
      left={
        <Bullets size={29}>
          <Li k="Base">Hillshade (standard, combined, Igor, multidirectional, aspect-tinted, duotone NW/NE), hypsometric tint, contours.</Li>
          <Li k="Terrain analysis">slope, aspect, curvature, TRI, TPI, roughness, structure-tensor blobness and orientation.</Li>
          <Li k="Relief">LRM, sky-view factor, openness, local dominance: the RVT toolbox, in the browser.</Li>
          <Li k="Light">matcap, Phong, cast shadows from a real sun position, OSM building shadows on the GPU.</Li>
          <Li k="gdaldem and RVT">are the references; each mode links its paper.</Li>
        </Bullets>
      }
      right={<Shot src={combined} caption="Contours + hillshade + hypso + raster basemap, Karakoram" width={940} height={600} />}
    />
  </Frame>
);

const P7Views: Page = () => (
  <Frame eyebrow="View modes" title="2D, 3D and globe, one camera">
    <TwoCol
      leftWidth={700}
      left={
        <Bullets>
          <Li k="2D">north-up plan view; snapshots come with a world file.</Li>
          <Li k="3D">MapLibre terrain mesh, pitch and bearing, exaggeration slider.</Li>
          <Li k="Globe">the same layers draped on the sphere.</Li>
          <Li k="Camera sync">across every split view: six parameters, elevation included.</Li>
          <Li k="Light">hold L and drag on the map, or drive it from a date and time.</Li>
        </Bullets>
      }
      right={<Shot src={globe} caption="Globe view" width={1000} height={620} />}
    />
  </Frame>
);

const P8Split: Page = () => (
  <Frame eyebrow="Compare" title="Split, overlay, grid: up to 8 views">
    <div style={{ display: 'flex', gap: 40 }}>
      <Shot src={splitCompare} caption="Side-by-side, Mapterhorn vs AWS" width={840} height={470} />
      <Shot src={modesPerView} caption="Modes per view: slope on A, hillshade on B…" width={840} height={470} />
    </div>
    <div style={{ display: 'flex', gap: 24, marginTop: 34 }}>
      <Card title="Off">One view.</Card>
      <Card title="Overlay">A over B, wipe gutter, opacity, blend: normal, multiply, difference.</Card>
      <Card title="Side">2×1 to 4×2, views A to H, a source and a date per view.</Card>
      <Card title="Match colors" accent={teal}>Histogram-match every view to A: RGB live, or LAB / LCH.</Card>
    </div>
  </Frame>
);

const P9Bookmarks: Page = () => (
  <Frame eyebrow="Bookmarks" title="A name, a thumbnail, a query string">
    <TwoCol
      leftWidth={680}
      left={
        <Bullets>
          <Li k="Projects">a viewport, with child views: same place, different modes.</Li>
          <Li k="Gallery">every bookmark as a card, sortable, plus a Featured strip.</Li>
          <Li k="Import / export">JSON, merged by id.</Li>
          <Li k="By link">?bookmarksUrl=… hands a curated list to a visitor.</Li>
        </Bullets>
      }
      right={<Shot src={bookmarks} caption="Bookmarks gallery" width={1000} height={620} />}
    />
  </Frame>
);

const P10Share: Page = () => (
  <Frame eyebrow="Share" title="The link is the whole view">
    <TwoCol
      leftWidth={820}
      left={
        <>
          <Bullets size={29}>
            <Li k="Share modal">X, Bluesky, Mastodon, LinkedIn, Threads, Reddit; a screenshot copied along.</Li>
            <Li k="Your sources travel">a remote COG or tile URL is written into the link by URL, so the recipient loads it too.</Li>
            <Li k="Embed">an iframe is the same link in a src; sidebarCollapsed=true hides the panel.</Li>
            <Li k="Snapshot">JPEG of the map area, with a .jgw world file in 2D.</Li>
          </Bullets>
          <div style={{ marginTop: 30 }}>
            <Code size={22}>{`?terrainSourceA=https://host/dem.tif&viewMode=3d
&showHillshade=true&showSvf=true&lat=45.97&lng=7.65&zoom=12.6`}</Code>
          </div>
        </>
      }
      right={<Shot src={shareModal} caption="Share modal" width={880} height={600} />}
    />
  </Frame>
);

const P11Docs: Page = () => (
  <Frame eyebrow="Docs and assistants" title="Docs, a skill, llms.txt, an OpenAPI">
    <TwoCol
      leftWidth={820}
      left={
        <>
          <Bullets size={29}>
            <Li k="/docs">features, dev deep dives, equations, 130+ research references.</Li>
            <Li k="Skill">one file that teaches an agent to build a link for any place and mode.</Li>
            <Li k="/llms.txt">the same for assistants that read the web.</Li>
            <Li k="openapi.json">every URL parameter, typed, with defaults.</Li>
            <Li k="STAC">every source the app knows, as a static catalog with web-map-links.</Li>
          </Bullets>
          <div style={{ marginTop: 30 }}>
            <Code size={24}>{`npx skills add Iconem/terrain-viewer
"Open the Matterhorn in sky-view factor with contours, tilted 3D"`}</Code>
          </div>
        </>
      }
      right={<Shot src={skillView} caption="What the skill answered" width={880} height={600} />}
    />
  </Frame>
);

const P12Close: Page = () => (
  <Closing
    title={
      <>
        Open it.
        <br />
        <span style={{ color: 'var(--osd-accent)' }}>Pan somewhere.</span>
      </>
    }
    lines={[
      'terrain-viewer.iconem.com',
      'terrain-viewer.iconem.com/docs',
      'github.com/Iconem/terrain-viewer',
      'historical-satellite.iconem.com  →  the historical deck',
    ]}
  />
);

export const notes: (string | undefined)[] = [
  'Terrain Viewer: a free browser app for elevation data and historical imagery. Everything you see in this deck is a link you can open.',
  'No backend. The browser fetches tiles, decodes them and computes every derivative. The URL holds the state, so a view is a link.',
  'Five global sources ship built in. Mapterhorn is the default: Copernicus GLO-30 with national LiDAR composited in.',
  'The library streams national LiDAR live from the agencies: half a metre over France and the Netherlands against 30 m for a global DEM.',
  'Twelve of the modes, same view. All are cards in the Data layers picker.',
  'They stack. Each has its own opacity slider, and each links to the paper it comes from.',
  'Same camera in 2D, 3D and on the globe. In a split, the camera syncs across every view.',
  'Compare two sources or eight. Overlay has a wipe gutter and blend modes; Side is a grid; Match colors makes different providers agree.',
  'Bookmarks are query strings with a thumbnail. Export, import, hand them out by link.',
  'Share is the current URL. Your own remote sources are written into it so the recipient sees what you see.',
  'There is a skill and an llms.txt, so an assistant can answer a question with a link that opens the right view.',
  'Open it and pan somewhere you know.',
];

export const meta: SlideMeta = {
  title: 'Terrain Viewer',
  createdAt: '2026-10-05T13:22:28.903Z',
};

export default [
  P1Cover,
  P2What,
  P3Sources,
  P4National,
  P5ModesGrid,
  P6Stack,
  P7Views,
  P8Split,
  P9Bookmarks,
  P10Share,
  P11Docs,
  P12Close,
] satisfies Page[];
