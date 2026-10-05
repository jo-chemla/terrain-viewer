import { type DesignSystem, type Page, type SlideMeta, Step, Steps, useSlidePageNumber } from '@open-slide/core';
import type { CSSProperties, ReactNode } from 'react';

import lrm from '@assets/screenshots/viz-modes/lrm.jpg';
import lrmR4 from '@assets/screenshots/viz-modes/lrm-r4.jpg';
import lrmR16 from '@assets/screenshots/viz-modes/lrm-r16.jpg';
import lrmR64 from '@assets/screenshots/viz-modes/lrm-r64.jpg';
import svf from '@assets/screenshots/viz-modes/svf.jpg';
import tpi from '@assets/screenshots/viz-modes/tpi.jpg';
import curvature from '@assets/screenshots/viz-modes/curvature.jpg';
import byodDiff from '@assets/screenshots/byod-difference-dsm-dtm.jpg';
import riverRem from '@assets/screenshots/river-rem.jpg';
import grid42 from '@assets/screenshots/split-modes/historical-grid-4x2.jpg';
import terrainAnalysis from '@assets/screenshots/terrain-analysis-full.jpg';
import coverage3d from '@assets/screenshots/coverage-3d-lidar-europe.jpg';

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

const DECK = 'Research';
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
        <span style={{ color: 'var(--osd-accent)' }}>▲</span> Terrain Viewer · {DECK} · terrain-viewer.iconem.com/docs/resources/research-references
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

const Ref = ({ who, year, what, where }: { who: string; year: string; what: string; where: string }) => (
  <div style={{ padding: '12px 0', borderBottom: `1px solid ${rule}`, fontSize: 24, lineHeight: 1.35 }}>
    <span style={{ fontWeight: 700 }}>{who}</span> <span style={{ fontFamily: mono, color: 'var(--osd-accent)' }}>{year}</span>
    <span style={{ color: muted }}> · {what}</span> <span style={{ color: dim }}>· {where}</span>
  </div>
);

const Formula = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      fontFamily: mono,
      fontSize: 30,
      background: 'rgba(0,0,0,0.35)',
      border: `1px solid ${rule}`,
      borderRadius: 12,
      padding: '18px 26px',
      color: '#dbe4f3',
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
    }}
  >
    {children}
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
      terrain-viewer.iconem.com/docs/resources/research-references
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
    bg={lrm}
    eyebrow="Research themes"
    title={
      <>
        Reading the ground
      </>
    }
    subtitle="Landscape archaeology and earth surface processes with elevation data and a time axis, in a browser tab."
  />
);

const P2Four: Page = () => (
  <Frame eyebrow="Why terrain" title="Four things turn heights into evidence">
    <Steps>
      <div style={{ display: 'flex', gap: 24 }}>
        <Card title="Relief visualization" accent={teal}>Hillshade, sky-view factor, openness, local relief: centimetre-to-metre features legible whatever their orientation.</Card>
        <Card title="Terrain derivatives">Slope, curvature, TPI, ruggedness: numbers on form, so landforms can be classified and mapped.</Card>
        <Card title="Differences of surveys" accent={rose}>Uplift of an earthquake, thickness of a lava flow, ice a glacier lost, rock an avalanche removed.</Card>
        <Card title="Historical imagery" accent="#a78bfa">The time axis for the surface itself: looting pits, a site under a new town, a coastline retreating.</Card>
      </div>
      <Step>
        <div style={{ display: 'flex', gap: 24, marginTop: 40 }}>
          <Card title="The data changed">Airborne LiDAR through canopy at 0.5 m, published openly by England, the Netherlands, France, Switzerland, the USA. Elsewhere Copernicus GLO-30 gives every place a 30 m surface.</Card>
          <Card title="130+ references" accent={teal}>Every one checked against its DOI, each linked to its study area in the app with the modes the paper used.</Card>
        </div>
      </Step>
    </Steps>
  </Frame>
);

const P3Archaeology: Page = () => (
  <Frame eyebrow="Landscape archaeology" title="The RVT toolbox, in the browser">
    <TwoCol
      leftWidth={900}
      left={
        <>
          <Ref who="Hesse" year="2010" what="LiDAR-derived Local Relief Models" where="Archaeological Prospection 17" />
          <Ref who="Zakšek, Oštir, Kokalj" year="2011" what="Sky-view factor as a relief visualization technique" where="Remote Sensing 3" />
          <Ref who="Kokalj, Zakšek, Oštir" year="2011" what="Sky-view factor for historic landscape features in LiDAR" where="Antiquity 85" />
          <Ref who="Doneus" year="2013" what="Openness for interpretative mapping of LiDAR DTMs" where="Remote Sensing 5" />
          <Ref who="Kokalj, Hesse" year="2017" what="ALS raster data visualization: a guide to good practice" where="ZRC SAZU" />
          <Ref who="Hesse" year="2016" what="Local dominance" where="Remote Sensing 8" />
          <div style={{ marginTop: 26 }}>
            <Bullets size={26}>
              <Li k="LRM">elevation minus a low-pass trend: the small bumps, whatever the slope.</Li>
              <Li k="SVF">fraction of sky seen: pits dark, ridges bright, no light direction.</Li>
              <Li k="Openness">+ for crests and banks, − for ditches and channels.</Li>
            </Bullets>
          </div>
        </>
      }
      right={<Shot src={svf} caption="Sky-view factor over hillshade, Matterhorn" width={800} height={600} />}
    />
  </Frame>
);

const P4Radius: Page = () => (
  <Frame eyebrow="LRM" title="One slider, three questions">
    <div style={{ display: 'flex', gap: 28 }}>
      <Shot src={lrmR4} caption="Radius 4 px: barely more than a 3×3 blur" width={548} height={340} />
      <Shot src={lrmR16} caption="Radius 16 px, the default" width={548} height={340} />
      <Shot src={lrmR64} caption="Radius 64 px: a broad regional trend" width={548} height={340} />
    </div>
    <div style={{ display: 'flex', gap: 24, marginTop: 40 }}>
      <Card title="In metres">radius × ground resolution at this zoom, shown live beside the slider.</Card>
      <Card title="Free low-pass" accent={teal}>the ancestor tile k levels up is already the blur: no kernel to run.</Card>
      <Card title="Pick the scale">a barrow wants 4-8 px at z16; a field system 16; a terrace 64.</Card>
    </div>
  </Frame>
);

const P5Tells: Page = () => (
  <Frame eyebrow="Mounds and tells" title="Detect candidates, then look at every one">
    <TwoCol
      leftWidth={820}
      left={
        <>
          <Bullets size={27}>
            <Li k="Tells detector (beta)">Difference-of-Gaussians of the LRM, non-maximum suppression at the tell size, three vetoes: blobness, plan curvature, det-Hessian.</Li>
            <Li k="Resolution is the limit">Bronze and Iron Age mounds run 50-300 m across, 3-20 m tall; a 30 m DEM misses the small end. LiDAR finds it.</Li>
            <Li k="Iterate">import an inventory, step through sites with → and N, delete with D.</Li>
            <Li k="Aguada Fénix">a platform invisible from the ground, unmistakable in a hillshade: the LiDAR dataset itself is in the library.</Li>
          </Bullets>
          <div style={{ marginTop: 26 }}>
            <Ref who="Inomata et al." year="2020" what="Monumental architecture at Aguada Fénix" where="Nature 582" />
            <Ref who="Canuto et al." year="2018" what="Lowland Maya complexity from airborne laser scanning" where="Science 361" />
            <Ref who="Verschoof-van der Vaart, Lambers" year="2019" what="R-CNN detection of barrows and Celtic fields on AHN" where="J. Computer Applications in Archaeology" />
          </div>
        </>
      }
      right={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Shot src={terrainAnalysis} caption="Terrain analysis submodes, with per-tile provenance" width={860} height={440} />
          <Card title="Heritage Quest" accent={teal}>Citizen science on AHN LiDAR for barrows and Celtic fields (Zooniverse). The viewer with AHN and the mound detector is the same question put to a browser.</Card>
        </div>
      }
    />
  </Frame>
);

const P6Change: Page = () => (
  <Frame eyebrow="Earth surface processes" title="DEM of difference: what moved between two surveys">
    <TwoCol
      leftWidth={820}
      left={
        <>
          <Bullets size={27}>
            <Li k="Bhotekoshi 2026">post-event 0.5 m DSM minus GLO-30; geo-pera's corrected 2 m dh raster beside it.</Li>
            <Li k="Columbia Glacier 2012-2021">two ArcticDEM strips subtracted: tens of metres of ice lost at the front.</Li>
            <Li k="Ridgecrest 2019">coseismic change, a diverging ramp around zero.</Li>
            <Li k="Three traps">vertical datum (ellipsoid vs geoid), reference resolution, co-registration.</Li>
          </Bullets>
          <div style={{ marginTop: 26 }}>
            <Ref who="Shugar et al." year="2021" what="The 2021 Chamoli rock and ice avalanche" where="Science" />
            <Ref who="Mannerfelt et al." year="2022" what="Halving of Swiss glacier volume since 1931" where="The Cryosphere" />
            <Ref who="Iverson et al." year="2015" what="Landslide mobility: the 2014 Oso disaster" where="EPSL" />
          </div>
        </>
      }
      right={<Shot src={byodDiff} caption="A difference source over a symmetric hypsometric ramp" width={880} height={600} />}
    />
  </Frame>
);

const P7River: Page = () => (
  <Frame eyebrow="Rivers and palaeochannels" title="Relative elevation: metres above the river">
    <TwoCol
      leftWidth={780}
      left={
        <>
          <Formula>{`REM = DEM − WSE(interpolated along the centreline)`}</Formula>
          <div style={{ marginTop: 26 }}>
            <Bullets size={27}>
              <Li k="Why">meander scrolls, terraces and palaeochannels are metre-scale relief on a flat floodplain; a hypsometric ramp hides them.</Li>
              <Li k="River-REM">Iconem's companion app: OSM centreline, WSE sampled from Mapterhorn, detrended live in a rem:// protocol.</Li>
              <Li k="Interpolation">IDW (classic, bull's-eyes), nearest-polyline (clean bands), Euclidean distance transform (O(cells)).</Li>
              <Li k="Open In">hands the current viewport to River-REM.</Li>
            </Bullets>
          </div>
          <div style={{ marginTop: 22 }}>
            <Ref who="Strick et al." year="2018" what="Morphology and spacing of river meander scrolls" where="Geomorphology" />
          </div>
        </>
      }
      right={<Shot src={riverRem} caption="River-REM: a detrended floodplain, meander scrolls visible" width={920} height={600} />}
    />
  </Frame>
);

const P8Geomorph: Page = () => (
  <Frame eyebrow="Geomorphometry" title="Slope, curvature, TPI: numbers on landforms">
    <TwoCol
      leftWidth={840}
      left={
        <>
          <Ref who="Horn" year="1981" what="Hill shading and the reflectance map: the 3×3 gradient" where="Proc. IEEE" />
          <Ref who="Zevenbergen, Thorne" year="1987" what="Quantitative analysis of land surface topography" where="ESPL" />
          <Ref who="Weiss" year="2001" what="Topographic position and landforms analysis" where="ESRI UC" />
          <Ref who="Riley, DeGloria, Elliot" year="1999" what="Terrain ruggedness index" where="Intermountain J. Sci." />
          <Ref who="Van Den Eeckhaut et al." year="2012" what="Forested landslides from LiDAR derivatives" where="Geomorphology" />
          <Ref who="Verbovšek, Popit, Kokalj" year="2019" what="VAT for mass-movement features" where="Remote Sensing" />
          <Ref who="Yu, Eyles, Sookhan" year="2015" what="Drumlin shape and volume from LiDAR" where="Geomorphology" />
          <div style={{ marginTop: 22 }}>
            <Bullets size={26}>
              <Li k="Landslides">head scarps and hummocks in SVF and openness; inventories by derivative.</Li>
              <Li k="Glacial landforms">drumlins, moraines, eskers: TPI and curvature with LiDAR.</Li>
            </Bullets>
          </div>
        </>
      }
      right={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Shot src={curvature} caption="Profile curvature" width={840} height={290} position="center" />
          <Shot src={tpi} caption="Topographic position index" width={840} height={290} position="center" />
        </div>
      }
    />
  </Frame>
);

const P9Imagery: Page = () => (
  <Frame eyebrow="Historical imagery" title="The time axis: looting, damage, change">
    <TwoCol
      leftWidth={840}
      left={
        <>
          <Ref who="Parcak et al." year="2016" what="Satellite evidence of looting in Egypt, 2002-2013" where="Antiquity" />
          <Ref who="Casana, Laugier" year="2017" what="Monitoring site damage in the Syrian civil war" where="PLOS ONE" />
          <Ref who="Ur" year="2003" what="CORONA photography and ancient road networks" where="Antiquity" />
          <Ref who="Casana, Cothren, Kalayci" year="2012" what="Archaeological applications of CORONA" where="Internet Archaeology" />
          <Ref who="Westley et al." year="2023" what="Coastal erosion and the archaeology of Cyrenaica" where="PLOS ONE" />
          <Ref who="Haritashya et al." year="2018" what="Large glacial lakes in the Nepal Himalaya" where="Remote Sensing" />
          <div style={{ marginTop: 22 }}>
            <Bullets size={26}>
              <Li k="In the app">Wayback since 2014, Google Earth often to the early 2000s, CORONA KH-4 1963-72, national archives to the 1920s.</Li>
              <Li k="Compare">Difference blend between two dates; eight dates in a grid.</Li>
            </Bullets>
          </div>
        </>
      }
      right={<Shot src={grid42} caption="Eight dates over Île de la Cité" width={860} height={600} />}
    />
  </Frame>
);

const P10Workflow: Page = () => (
  <Frame eyebrow="What can be done" title="A survey, start to finish, without installing anything">
    <Steps>
      <div style={{ display: 'flex', gap: 24 }}>
        <Card title="1 · Find data" accent={teal}>Coverage overlays: is there LiDAR here? Load it from the library, or search STAC.</Card>
        <Card title="2 · Look">Stack SVF + LRM + openness at the right radius; tilt in 3D; drive the light from a date.</Card>
        <Card title="3 · Measure" accent={rose}>Profiles, a plane slicer, an iso-line at one height, a difference of two surveys.</Card>
      </div>
      <Step>
        <div style={{ display: 'flex', gap: 24, marginTop: 28 }}>
          <Card title="4 · Review">Import the inventory, iterate feature by feature, draw what you see.</Card>
          <Card title="5 · Export" accent="#a78bfa">Float32 GeoTIFFs of raw values, contours as GeoJSON, on one EPSG:3857 grid, into QGIS.</Card>
          <Card title="6 · Share" accent={teal}>The link reproduces the view; bookmarks by URL; an iframe in the paper's blog post.</Card>
        </div>
      </Step>
    </Steps>
  </Frame>
);

const P11Limits: Page = () => (
  <Frame eyebrow="Where it stops" title="Honest about the limits">
    <TwoCol
      leftWidth={900}
      left={
        <Bullets size={29}>
          <Li k="Resolution">a 30 m global DEM is a 30 m DEM; the viewer cannot sharpen it.</Li>
          <Li k="Datums">no vertical transformation; differences need matching references.</Li>
          <Li k="CPU">derivatives run per tile in JavaScript; SVF over a wide radius takes a moment.</Li>
          <Li k="Not an ephemeris">solar position is closed-form, local solar time, no refraction.</Li>
          <Li k="Browser memory">a 96 MB result cache; huge exports go through gdal_translate scripts.</Li>
          <Li k="Access">what an agency puts behind a login stays there.</Li>
        </Bullets>
      }
      right={<Shot src={coverage3d} caption="Where fine data exists: 3D mesh and LiDAR footprints over Europe" width={800} height={560} />}
    />
  </Frame>
);

const P12Close: Page = () => (
  <Closing
    title={
      <>
        Every reference
        <br />
        <span style={{ color: 'var(--osd-accent)' }}>opens its site.</span>
      </>
    }
    lines={[
      'terrain-viewer.iconem.com/docs/resources/research-references',
      'terrain-viewer.iconem.com/docs/features/national-datasets',
      'terrain-viewer.iconem.com/docs/features/river-rem',
      'terrain-viewer.iconem.com/docs/resources/compared-with-other-tools',
    ]}
  />
);

export const notes: (string | undefined)[] = [
  'A deck for researchers: what the app does for landscape archaeology and for earth surface processes, with the papers behind each mode.',
  'Four mechanisms recur through every field: relief visualization, derivatives, differences of surveys, and the imagery time axis.',
  'The archaeological toolbox is RVT, and the app implements it: LRM, sky-view factor, openness, local dominance.',
  'The LRM radius is a scale choice. The app shows the radius in metres so you know what neighbourhood you are looking at.',
  'The tells detector proposes candidates; the iterator lets you look at each one. Resolution is the limit, not the method.',
  'A DEM of difference is a terrain source like any other. Three things break it: datum, resolution, co-registration.',
  'River REM is the river-referenced cousin of the LRM, in a companion app one click away.',
  'The derivatives are the classic geomorphometry formulas, as implemented: Horn, Zevenbergen and Thorne, Weiss.',
  'Historical imagery is the time axis. Looting, war damage, coasts, glaciers, year by year.',
  'A workflow from finding data to exporting into QGIS, all in the browser.',
  'The limits, plainly.',
  'The research references page is the place to start: every reference opens its study area.',
];

export const meta: SlideMeta = {
  title: 'Research themes',
  createdAt: '2026-10-05T13:22:28.903Z',
};

export default [
  P1Cover,
  P2Four,
  P3Archaeology,
  P4Radius,
  P5Tells,
  P6Change,
  P7River,
  P8Geomorph,
  P9Imagery,
  P10Workflow,
  P11Limits,
  P12Close,
] satisfies Page[];
