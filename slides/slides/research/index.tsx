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

const DECK = 'Research';
const FOOT = 'terrain viewer · research · terrain-viewer.iconem.com/docs';

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

// ─── Citations ──────────────────────────────────────────────────────────────
// From docs/src/data/research-references.json (the Research References page).
// `short` is the footer line; the References page prints the full record.

type Paper = { who: string; year: number; short: string; title: string; venue: string; doi: string };

const PAPERS = {
  kokaljHesse2017: {
    who: 'Kokalj, Ž., Hesse, R.',
    year: 2017,
    short: 'Kokalj & Hesse (2017), ALS raster data visualization: a guide to good practice',
    title: 'Airborne laser scanning raster data visualization: A guide to good practice',
    venue: 'Prostor, kraj, čas 14, ZRC SAZU',
    doi: '10.3986/9789612549848',
  },
  esa2022: {
    who: 'European Space Agency',
    year: 2022,
    short: 'ESA (2022), Copernicus DEM, global and European digital elevation model',
    title: 'Copernicus DEM - Global and European Digital Elevation Model',
    venue: 'Copernicus Data Space Ecosystem (dataset)',
    doi: '10.5270/ESA-c5d3d65',
  },
  zaksek2011: {
    who: 'Zakšek, K., Oštir, K., Kokalj, Ž.',
    year: 2011,
    short: 'Zakšek et al. (2011), Sky-view factor as a relief visualization technique',
    title: 'Sky-View Factor as a Relief Visualization Technique',
    venue: 'Remote Sensing 3(2)',
    doi: '10.3390/rs3020398',
  },
  hesse2010: {
    who: 'Hesse, R.',
    year: 2010,
    short: 'Hesse (2010), LiDAR-derived local relief models',
    title: 'LiDAR-derived Local Relief Models - a new tool for archaeological prospection',
    venue: 'Archaeological Prospection 17',
    doi: '10.1002/arp.374',
  },
  orengoPetrie2018: {
    who: 'Orengo, H. A., Petrie, C. A.',
    year: 2018,
    short: 'Orengo & Petrie (2018), Multi-scale relief model (MSRM)',
    title:
      'Multi-scale relief model (MSRM): a new algorithm for the visualization of subtle topographic change of variable size in digital elevation models',
    venue: 'Earth Surface Processes and Landforms 43',
    doi: '10.1002/esp.4317',
  },
  menzeUr2012: {
    who: 'Menze, B. H., Ur, J. A.',
    year: 2012,
    short: 'Menze & Ur (2012), Long-term settlement in Northern Mesopotamia at a large scale',
    title: 'Mapping patterns of long-term settlement in Northern Mesopotamia at a large scale',
    venue: 'Proceedings of the National Academy of Sciences 109(14)',
    doi: '10.1073/pnas.1115472109',
  },
  orengo2020: {
    who: 'Orengo, H. A., Conesa, F. C., Garcia-Molsosa, A., et al.',
    year: 2020,
    short: 'Orengo et al. (2020), Automated detection of archaeological mounds',
    title:
      'Automated detection of archaeological mounds using machine-learning classification of multisensor and multitemporal satellite data',
    venue: 'Proceedings of the National Academy of Sciences 117(31)',
    doi: '10.1073/pnas.2005583117',
  },
  shugar2021: {
    who: 'Shugar, D. H., Jacquemart, M., Shean, D., et al.',
    year: 2021,
    short: 'Shugar et al. (2021), The 2021 Chamoli rock and ice avalanche',
    title: 'A massive rock and ice avalanche caused the 2021 disaster at Chamoli, Indian Himalaya',
    venue: 'Science 373',
    doi: '10.1126/science.abh4455',
  },
  mannerfelt2022: {
    who: 'Mannerfelt, E. S., Dehecq, A., Hugonnet, R., et al.',
    year: 2022,
    short: 'Mannerfelt et al. (2022), Halving of Swiss glacier volume since 1931',
    title: 'Halving of Swiss glacier volume since 1931 observed from terrestrial image photogrammetry',
    venue: 'The Cryosphere 16',
    doi: '10.5194/tc-16-3249-2022',
  },
  strick2018: {
    who: 'Strick, R. J. P., Ashworth, P. J., Awcock, G., et al.',
    year: 2018,
    short: 'Strick et al. (2018), Morphology and spacing of river meander scrolls',
    title: 'Morphology and spacing of river meander scrolls',
    venue: 'Geomorphology 310',
    doi: '10.1016/j.geomorph.2018.03.005',
  },
  singh2017: {
    who: 'Singh, A., Thomsen, K. J., Sinha, R., et al.',
    year: 2017,
    short: 'Singh et al. (2017), Himalayan river morphodynamics and Indus urban settlements',
    title: 'Counter-intuitive influence of Himalayan river morphodynamics on Indus Civilisation urban settlements',
    venue: 'Nature Communications 8',
    doi: '10.1038/s41467-017-01643-9',
  },
  horn1981: {
    who: 'Horn, B. K. P.',
    year: 1981,
    short: 'Horn (1981), Hill shading and the reflectance map',
    title: 'Hill shading and the reflectance map',
    venue: 'Proceedings of the IEEE 69(1)',
    doi: '10.1109/PROC.1981.11918',
  },
  zevenbergenThorne1987: {
    who: 'Zevenbergen, L. W., Thorne, C. R.',
    year: 1987,
    short: 'Zevenbergen & Thorne (1987), Quantitative analysis of land surface topography',
    title: 'Quantitative analysis of land surface topography',
    venue: 'Earth Surface Processes and Landforms 12',
    doi: '10.1002/esp.3290120107',
  },
  parcak2016: {
    who: 'Parcak, S., Gathings, D., Childs, C., et al.',
    year: 2016,
    short: 'Parcak et al. (2016), Satellite evidence of site looting in Egypt, 2002-2013',
    title: 'Satellite evidence of archaeological site looting in Egypt: 2002-2013',
    venue: 'Antiquity 90',
    doi: '10.15184/aqy.2016.1',
  },
  casanaLaugier2017: {
    who: 'Casana, J., Laugier, E. J.',
    year: 2017,
    short: 'Casana & Laugier (2017), Satellite monitoring of site damage in the Syrian civil war',
    title: 'Satellite imagery-based monitoring of archaeological site damage in the Syrian civil war',
    venue: 'PLOS ONE 12(11)',
    doi: '10.1371/journal.pone.0188589',
  },
  kokaljSomrak2019: {
    who: 'Kokalj, Ž., Somrak, M.',
    year: 2019,
    short: 'Kokalj & Somrak (2019), Why not a single image? Combining visualizations',
    title: 'Why Not a Single Image? Combining Visualizations to Facilitate Fieldwork and On-Screen Mapping',
    venue: 'Remote Sensing 11(7)',
    doi: '10.3390/rs11070747',
  },
  guthGeoffroy2021: {
    who: 'Guth, P. L., Geoffroy, T. M.',
    year: 2021,
    short: 'Guth & Geoffroy (2021), Evaluation of 1 second global DEMs: Copernicus wins',
    title: 'LiDAR point cloud and ICESat-2 evaluation of 1 second global digital elevation models: Copernicus wins',
    venue: 'Transactions in GIS 25',
    doi: '10.1111/tgis.12825',
  },
  bielski2024: {
    who: 'Bielski, C., López-Vázquez, C., Grohmann, C. H., et al.',
    year: 2024,
    short: 'Bielski et al. (2024), Ranking DEMs: Copernicus DEM improves one arc second topography',
    title: 'Novel Approach for Ranking DEMs: Copernicus DEM Improves One Arc Second Open Global Topography',
    venue: 'IEEE Transactions on Geoscience and Remote Sensing 62',
    doi: '10.1109/TGRS.2024.3368015',
  },
} satisfies Record<string, Paper>;

type PaperKey = keyof typeof PAPERS;

// Order of first citation in the deck; the References page follows it.
const CITED: PaperKey[] = [
  'kokaljHesse2017',
  'esa2022',
  'zaksek2011',
  'hesse2010',
  'orengoPetrie2018',
  'menzeUr2012',
  'orengo2020',
  'shugar2021',
  'mannerfelt2022',
  'strick2018',
  'singh2017',
  'horn1981',
  'zevenbergenThorne1987',
  'parcak2016',
  'casanaLaugier2017',
  'kokaljSomrak2019',
  'guthGeoffroy2021',
  'bielski2024',
];

// One muted line per paper, above the footer (the content box ends at 84 px
// from the bottom; nothing on a content page reaches it).
const Cite = ({ refs }: { refs: PaperKey[] }) => (
  <div
    style={{
      position: 'absolute',
      left: PAD_X,
      right: PAD_X,
      bottom: 80,
      fontFamily: font.mono,
      fontSize: 18,
      lineHeight: '23px',
      color: ink.dim,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}
  >
    {refs.map((k) => (
      <div key={k} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {PAPERS[k].short}, doi:{PAPERS[k].doi}
      </div>
    ))}
  </div>
);

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

const Frame = ({
  eyebrow,
  title,
  refs,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  refs?: PaperKey[];
  children: ReactNode;
}) => (
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
    {refs && refs.length ? <Cite refs={refs} /> : null}
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
  // The frame is filled; a 16:9 frame shows a screenshot whole, any other
  // ratio crops from the left so the side panel and its padding stay.
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
  <Frame eyebrow="Why terrain" title="Four things turn heights into evidence" refs={['kokaljHesse2017', 'esa2022']}>
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
  <Frame eyebrow="Landscape archaeology" title="The RVT toolbox, in the browser" refs={['zaksek2011', 'hesse2010']}>
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
  <Frame eyebrow="LRM" title="One slider, three questions" refs={['hesse2010', 'orengoPetrie2018']}>
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
  <Frame eyebrow="Mounds and tells" title="Detect candidates, then look at every one" refs={['menzeUr2012', 'orengo2020']}>
    <TwoCol
      leftWidth={820}
      left={
        <>
          <Bullets size={24}>
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
          <Shot src={terrainAnalysis} caption="Terrain analysis submodes, with per-tile provenance" width={860} height={360} />
          <Card title="Heritage Quest" accent={teal}>Citizen science on AHN LiDAR for barrows and Celtic fields (Zooniverse). The viewer with AHN and the mound detector is the same question put to a browser.</Card>
        </div>
      }
    />
  </Frame>
);

const P6Change: Page = () => (
  <Frame
    eyebrow="Earth surface processes"
    title="DEM of difference: what moved between two surveys"
    refs={['shugar2021', 'mannerfelt2022']}
  >
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
  <Frame eyebrow="Rivers and palaeochannels" title="Relative elevation: metres above the river" refs={['strick2018', 'singh2017']}>
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
  <Frame eyebrow="Geomorphometry" title="Slope, curvature, TPI: numbers on landforms" refs={['horn1981', 'zevenbergenThorne1987']}>
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
  <Frame eyebrow="Historical imagery" title="The time axis: looting, damage, change" refs={['parcak2016', 'casanaLaugier2017']}>
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
  <Frame eyebrow="What can be done" title="A survey, start to finish, without installing anything" refs={['kokaljSomrak2019']}>
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
  <Frame eyebrow="Where it stops" title="Honest about the limits" refs={['guthGeoffroy2021', 'bielski2024']}>
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

const P12References: Page = () => {
  const half = Math.ceil(CITED.length / 2);
  const cols = [CITED.slice(0, half), CITED.slice(half)];
  return (
    <Frame eyebrow="References" title="The papers cited in this deck">
      <div style={{ display: 'flex', gap: 48 }}>
        {cols.map((col, c) => (
          <div key={c} style={{ flex: 1, minWidth: 0, borderBottom: `1px solid ${ink.rule}` }}>
            {col.map((k, i) => {
              const p = PAPERS[k];
              return (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    gap: 16,
                    alignItems: 'baseline',
                    padding: '7px 0',
                    borderTop: `1px solid ${ink.rule}`,
                    fontSize: 16,
                    lineHeight: 1.3,
                  }}
                >
                  <span style={{ fontFamily: font.mono, fontSize: 15, color: 'var(--osd-accent)', flex: 'none', width: 28 }}>
                    {pad2(c * half + i + 1)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 500, color: ink.text }}>{p.who}</span>{' '}
                    <span style={{ color: ink.soft }}>({p.year}). {p.title}.</span>{' '}
                    <span style={{ color: ink.muted }}>{p.venue}.</span>{' '}
                    <span style={{ fontFamily: font.mono, fontSize: 15, color: ink.dim, wordBreak: 'break-all' }}>
                      https://doi.org/{p.doi}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Frame>
  );
};

const P13Close: Page = () => (
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
  'The papers behind each page, in full, with their DOIs. All of them, and over a hundred more, are on the research references page.',
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
  P12References,
  P13Close,
] satisfies Page[];
