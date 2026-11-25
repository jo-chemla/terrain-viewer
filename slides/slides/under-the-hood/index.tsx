import { type DesignSystem, type Page, type SlideMeta, Step, Steps, useSlidePageNumber } from '@open-slide/core';
import type { CSSProperties, ReactNode } from 'react';

import { shot } from '@assets/shots';
const slope = shot('viz-modes/slope.jpg');
const phong = shot('viz-modes/phong.jpg');
const hardShadows = shot('viz-modes/hard-shadows.jpg');
const matcap = shot('viz-modes/matcap.jpg');
const lrmR64 = shot('viz-modes/lrm-r64.jpg');
const sourceInfo = shot('terrain-source-info.jpg');
const poPlain = shot('viz-modes/shadow-po-plain-sunset.jpg');

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

const DECK = 'Under the hood';
const FOOT = 'terrain viewer · under the hood · terrain-viewer.iconem.com/docs/dev';

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
    bg={slope}
    eyebrow="Under the hood"
    title={
      <>
        Protocols, kernels,
        <br />
        caches
      </>
    }
    subtitle="How a raster-dem tile becomes slope, sky-view factor or Phong shading without a server, and the one registry that holds it together."
  />
);

const P2Pipeline: Page = () => (
  <Frame eyebrow="Architecture" title="A custom protocol is a function MapLibre calls for a tile">
    <Steps>
      <div style={{ display: 'flex', gap: 18, alignItems: 'stretch' }}>
        <Box accent={teal}>MapLibre asks for<br /><span style={{ fontFamily: mono }}>slope://…/z/x/y</span></Box>
        <Arrow />
        <Box>Fetch centre tile + 8 neighbours<br /><span style={{ color: dim, fontSize: 21 }}>shared LRU cache</span></Box>
        <Arrow />
        <Box>Decode RGBA → Float32<br /><span style={{ color: dim, fontSize: 21 }}>Terrarium or Terrain-RGB</span></Box>
        <Arrow />
        <Box>Stitch a padded window<br /><span style={{ color: dim, fontSize: 21 }}>3×3, 5×5, or a radius</span></Box>
      </div>
      <Step>
        <div style={{ display: 'flex', gap: 18, alignItems: 'stretch', marginTop: 36 }}>
          <Box accent={rose}>Per-mode kernel<br /><span style={{ color: dim, fontSize: 21 }}>Horn, tensor, ray march</span></Box>
          <Arrow />
          <Box accent={rose}>Re-encode as pseudo-elevation<br /><span style={{ color: dim, fontSize: 21 }}>Terrarium bytes</span></Box>
          <Arrow />
          <Box accent={rose}>Return an ImageBitmap<br /><span style={{ color: dim, fontSize: 21 }}>not a PNG</span></Box>
          <Arrow />
          <Box accent={teal}><span style={{ fontFamily: mono }}>raster-dem</span> source<br /><span style={{ fontFamily: mono }}>color-relief</span> layer + ramp</Box>
        </div>
      </Step>
      <Step>
        <div style={{ display: 'flex', gap: 24, marginTop: 40 }}>
          <Card title="The trick">The derivative is smuggled through the elevation pixel format. MapLibre's own color-relief decodes and colours it; no mode hand-rolls an RGBA colormap.</Card>
          <Card title="Eleven modes, one pipeline" accent={teal}>slope, aspect, curvature, TRI, TPI, roughness, blobness, SVF, openness, local dominance… one formula each. LRM and lighting diverge.</Card>
        </div>
      </Step>
    </Steps>
  </Frame>
);

const P3Decode: Page = () => (
  <Frame eyebrow="Shared inputs" title="Decoding, and the Horn 3×3 gradient">
    <TwoCol
      leftWidth={900}
      left={
        <>
          <Formula label="Terrarium">{`h = (R·256 + G + B/256) − 32768`}</Formula>
          <Formula label="Mapbox Terrain-RGB">{`h = −10000 + (R·256² + G·256 + B)·0.1`}</Formula>
          <Formula label="Horn gradient, window a0..a8 row-major, L = ground resolution">{`∂z/∂x = (a0 + 2a3 + a6 − a2 − 2a5 − a8) / (8·L·cos lat)
∂z/∂y = (a6 + 2a7 + a8 − a0 − 2a1 − a2) / (8·L·cos lat)`}</Formula>
        </>
      }
      right={
        <>
          <Formula label="Slope">{`atan(√((∂z/∂x)² + (∂z/∂y)²)) · 180/π`}</Formula>
          <Formula label="Aspect">{`θ = atan2(∂z/∂y, −∂z/∂x)
aspect = (90 − θ) mod 360`}</Formula>
          <Formula label="TRI · TPI · roughness">{`√Σ(ai − a4)²   ·   a4 − mean(ai≠4)   ·   max − min`}</Formula>
          <p style={{ fontSize: 23, color: dim, margin: 0, lineHeight: 1.4 }}>Ported from GDAL's GDALSlopeHornAlg, Mercator-corrected by cos(lat) at the tile centre.</p>
        </>
      }
    />
  </Frame>
);

const P4Curvature: Page = () => (
  <Frame eyebrow="Curvature" title="One Zevenbergen & Thorne fit, five readings">
    <TwoCol
      leftWidth={860}
      left={
        <>
          <Formula label="Second-order fit (p, q first partials; r, t, s second)">{`p = (a5 − a3)/2L      r = (a5 − 2a4 + a3)/L²
q = (a7 − a1)/2L      t = (a7 − 2a4 + a1)/L²
s = (a2 − a0 − a8 + a6)/4L²        g = p² + q²`}</Formula>
          <Formula label="Profile (flow acceleration) · Plan (convergence)">{`profile = 100·(r·p² + 2spq + t·q²) / (g·(1+g)^1.5)
plan    = 100·(r·q² − 2spq + t·p²) / g^1.5`}</Formula>
          <Formula label="Combined · Det Hessian">{`∇²z = (a1 + a3 + a5 + a7 − 4a4)/L²        rt − s²`}</Formula>
        </>
      }
      right={
        <>
          <Formula label="Principal curvatures">{`κ1,2 = (r + t ± √((r−t)² + 4s²)) / 2`}</Formula>
          <Formula label="Casorati · Shape index">{`√((κ1² + κ2²)/2)
(2/π)·atan2(κ1+κ2, κ1−κ2) ∈ [−1, 1]`}</Formula>
          <Formula label="Structure tensor (blobness, 5×5 halo)">{`J = [Ixx Ixy; Ixy Iyy] of box-averaged gx², gy², gx·gy
blobness = det J / tr J · 100/64
eigen ratio = λmin/λmax`}</Formula>
        </>
      }
    />
  </Frame>
);

const P5Horizon: Page = () => (
  <Frame eyebrow="Relief visualization" title="One horizon march, three aggregations">
    <TwoCol
      leftWidth={900}
      left={
        <>
          <Formula label="Horizon angle, 8 compass directions, up to the search radius">{`θ(dir) = max over r=1..R of atan2(h(r) − h0, r·L)`}</Formula>
          <Formula label="Sky-view factor (Zakšek 2011)">{`SVF = (1 − mean(sin(max(θi, 0)))) · 100`}</Formula>
          <Formula label="Openness (Yokoyama 2002), not clamped">{`openness = mean(90° − θi)
negative openness = the same on −h`}</Formula>
          <Formula label="Local dominance (Hesse 2016), observer at 1.6 m">{`mean over dirs × distances of atan((z0 + 1.6 − z(d)) / d)`}</Formula>
        </>
      }
      right={
        <Bullets size={27}>
          <Li k="Why SVF feels slower">every tile needs the DEM well beyond its footprint; a view paints together once its neighbourhood decoded.</Li>
          <Li k="A max cannot be coarsened">skipping pixels could miss the narrow obstruction that sets the horizon. A mean can.</Li>
          <Li k="So local dominance">samples its far field from pyramid ancestors, one ring per octave.</Li>
          <Li k="Hard shadows">the same march in one direction only, the sun's real azimuth: in shadow if θ &gt; altitude.</Li>
        </Bullets>
      }
    />
  </Frame>
);

const P6Lrm: Page = () => (
  <Frame eyebrow="LRM" title="The pyramid is the low-pass filter">
    <TwoCol
      leftWidth={900}
      left={
        <>
          <Formula label="Local relief model">{`LRM = h_fine(native zoom) − bilinear(h_ancestor, k levels up)`}</Formula>
          <Code size={23}>{`export function radiusToLevels(radiusPx: number): number {
  return Math.min(6, Math.max(1, Math.round(Math.log2(Math.max(2, radiusPx)))))
}
// ancestorZ = z − k ; ancestorX = x >> k ; ancestorY = y >> k
const ancestorPxX = (xOffsetTiles * n + col + 0.5) / scale - 0.5`}</Code>
          <div style={{ marginTop: 22 }}>
            <Bullets size={25}>
              <Li k="Free">the tile server or COG overview already did the averaging; one ancestor backs up to 4^k fine tiles.</Li>
              <Li k="Half-pixel correction">ancestor pixel i sits at i + 0.5; without it LRM correlated with slope at −0.3…−0.6, with it ~0.</Li>
              <Li k="WMS has no pyramid">so the ancestor is requested small and upsampled client-side.</Li>
            </Bullets>
          </div>
        </>
      }
      right={<Shot src={lrmR64} caption="Radius 64 px: k = 6, a broad regional trend" width={800} height={560} />}
    />
  </Frame>
);

const P7Lighting: Page = () => (
  <Frame eyebrow="Lighting effects" title="A real normal, then shading on the GPU">
    <TwoCol
      leftWidth={900}
      left={
        <>
          <Formula label="Normal from the Horn gradient">{`ℓ = 1/√(dx² + dy² + 1)     n = (−dx·ℓ, −dy·ℓ, ℓ)`}</Formula>
          <Formula label="Phong: AMBIENT 0.35, SHININESS 32, H = normalize(L + V), V = (0,0,1)">{`diffuse  = kd · max(N·L, 0)
specular = ks · max(N·H, 0)^32
total = clamp(0.35 + diffuse, 0, 1) + specular`}</Formula>
          <Formula label="Fresnel rim (Schlick), live renderer only">{`rim = (1 − n·v)^p`}</Formula>
          <Formula label="Matcap">{`uv = rotate(nx, ny, θ)·0.5 + 0.5 → texture(uv)`}</Formula>
        </>
      }
      right={
        <>
          <div style={{ display: 'flex', gap: 16 }}>
            <Shot src={phong} width={250} height={160} position="center" />
            <Shot src={matcap} width={250} height={160} position="center" />
            <Shot src={hardShadows} width={250} height={160} position="center" />
          </div>
          <div style={{ marginTop: 24 }}>
            <Bullets size={25}>
              <Li k="Two paths">a raster protocol MapLibre drapes (bakes a nadir view), and a live CustomLayerInterface where a slider is a uniform write.</Li>
              <Li k="View-dependent terms">specular, camera matcap, fresnel: only the live path can draw them.</Li>
              <Li k="total ≤ 1">black at alpha 1 − total: multiply. total &gt; 1: white at total − 1: a highlight.</Li>
              <Li k="Three coloured lights">diffuse averaged per channel: the duotone LiDAR look with real specular.</Li>
            </Bullets>
          </div>
        </>
      }
    />
  </Frame>
);

const P7bShadows: Page = () => (
  <Frame eyebrow="Live GPU shadows" title="One ray per pixel, out past the edge of the view">
    <TwoCol
      leftWidth={860}
      left={
        <>
          <Formula label="Per fragment, a march toward the sun">{`steps: 1 texel × 40, then 1/40 of the distance
drop = d²(1 − k) / 2R, k ≈ 0.13 for refraction`}</Formula>
          <Formula label="Soft edge: the sun is a disc 0.53° across">{`visible = smoothstep(±0.27°, sun alt − horizon)
penumbra ≈ 0.0093·d: 9 m at 1 km, 90 m at 10 km`}</Formula>
          <Bullets size={24}>
            <Li k="Two R32F mosaics">the view's DEM tiles, then the same DEM three zooms coarser, at most 36 tiles: 81 × 81 km at zoom 13 in the Alps.</Li>
            <Li k="Far field after the view">the ray enters the coarse mosaic where it leaves the view mosaic; earlier, coarse ground would fill narrow valleys.</Li>
            <Li k="Moving the sun">uniforms and one draw. Soft or Hard is one uniform: no recompile, no upload.</Li>
            <Li k="Exports and the Iso-line">still read shadow:// tiles: hard, flat Earth, within the Search Radius.</Li>
          </Bullets>
        </>
      }
      right={
        <>
          <Shot src={poPlain} caption="The Alps' shadow over the Po plain east of Turin, sun 1.5° above the horizon from 255°" width={772} height={390} position="center" />
          <div style={{ marginTop: 20, borderBottom: `1px solid ${ink.rule}` }}>
            <Row k="87 km" v="that shadow with the Earth's curvature; 107 km on a flat Earth." />
            <Row k="IoU 0.98–0.999" v="against a long-reach reference, four cases; 0.86–0.98 before the far field." />
            <Row k="+0.2–1.5 ms" v="per 1280 × 800 frame for the far field; the soft edge under 0.1 ms in the mountains." />
          </div>
        </>
      }
    />
  </Frame>
);

const P8SourceProtocols: Page = () => (
  <Frame eyebrow="Source protocols" title="Elevation MapLibre cannot read, as Terrarium">
    <TwoCol
      leftWidth={1140}
      left={
        <>
          <Scheme s="float32dem://" what="a WMS or WCS returning float32 GeoTIFF per tile; WCS 2.0 via a subset= rewrite" />
          <Scheme s="lerc://" what="Esri LERC tiles from an ArcGIS ImageServer, decoded in the browser" />
          <Scheme s="vrt://" what="a GDAL VRT mosaic of COGs in any CRS, reprojected with proj4" />
          <Scheme s="quantized-mesh://" what="Cesium quantized-mesh terrain, rasterised" />
          <Scheme s="demdiff://" what="the difference of two sources: an nDSM, a change layer" />
          <Scheme s="cog://" what="geomatico: Cloud-Optimized GeoTIFF by range requests" accent={teal} />
          <Scheme s="pmtiles://" what="Protomaps archives" accent={teal} />
          <Scheme s="tv-contour://" what="maplibre-contour inside MapLibre's own workers, DEM fed through the registry" accent={teal} />
          <p style={{ fontSize: 22, color: dim, marginTop: 14, lineHeight: 1.35 }}>Region readers: a WMS, a VRT or a difference answers a whole export area in a few requests.</p>
        </>
      }
      right={<Shot src={sourceInfo} caption="Source info: encoding, licence, GDAL export" width={560} height={420} />}
    />
  </Frame>
);

const P9VizProtocols: Page = () => (
  <Frame eyebrow="Derived modes" title="Each mode is a scheme reading another scheme">
    <TwoCol
      leftWidth={1000}
      left={
        <>
          <Scheme s="slope:// aspect://" what="Horn gradient; slope packed Terrain-RGB, 0.1° step" />
          <Scheme s="curvature:// tpi:// tri:// roughness://" what="3×3 window, Terrarium packing, curvature ×1000 on the wire" />
          <Scheme s="blobness://" what="structure tensor, 5×5 halo: blobness, eigen ratio, orientation" />
          <Scheme s="svf:// openness:// local-dominance://" what="ray-marched horizon, wrapped in withSlowTileStats" />
          <Scheme s="lrm://" what="ancestor-tile low-pass" />
          <Scheme s="normals:// matcap:// phong:// shadow://" what="a real normal (WebGL2), shading, single-ray shadows" accent={rose} />
          <Scheme s="tells:// isoband:// unpaper://" what="mound candidates and iso-line polygons as vector tiles; old maps without their paper" accent={rose} />
          <Scheme s="cog-contour://" what="contours from a COG in a worker" accent={rose} />
        </>
      }
      right={
        <>
          <Code size={22}>{`slope://<upstream template>/{z}/{x}/{y}
// upstream may itself be
vrt://… or lerc://… or demdiff://…`}</Code>
          <div style={{ marginTop: 24 }}>
            <Card title="Key = URL" accent={teal}>buildProtocolUrl puts the upstream, the encoding, the tile size and every mode parameter in the URL. Change the sun azimuth: a different key. No invalidation logic anywhere.</Card>
          </div>
        </>
      }
    />
  </Frame>
);

const P10Registry: Page = () => (
  <Frame eyebrow="lib/protocol-registry.ts" title="One registry ties sources and modes together">
    <TwoCol
      leftWidth={960}
      left={
        <>
          <Code size={22}>{`import { registerProtocol, fetchTileBitmap, dispatchTile } from "@/lib/protocol-registry"

// TerrainViewer.tsx, once at startup
registerProtocol("vrt",   withTileResultCache(vrtProtocol))
registerProtocol("slope", withTileResultCache(slopeProtocol))
registerProtocol("svf",   withTileResultCache(withSlowTileStats("svf", svfProtocol)))

// anywhere: custom scheme → its handler, http(s) → fetch()
const bitmap = await fetchTileBitmap("vrt://…/15/8074/14743", signal)`}</Code>
          <div style={{ marginTop: 24 }}>
            <Card title="The rule">Register through registerProtocol, never maplibregl.addProtocol. Fetch a tile URL through fetchTileBitmap or dispatchTile, never fetch().</Card>
          </div>
        </>
      }
      right={
        <Bullets size={26}>
          <Li k="Why">MapLibre dispatches custom schemes for its own sources only; fetch("slope://…") fails.</Li>
          <Li k="Who else fetches">every derived mode reading its upstream, the GeoTIFF export, the 2D picker and profile, the contours, the mound detector.</Li>
          <Li k="Twice missed">LERC and quantized mesh, then VRT and demdiff: hillshade worked, every other mode drew nothing.</Li>
          <Li k="Now">a new source type works in every mode, export, picker and contour the day it is registered.</Li>
          <Li k="On globalThis">so a hot-reloaded copy of the module sees the same table.</Li>
        </Bullets>
      }
    />
  </Frame>
);

const P11Caches: Page = () => (
  <Frame eyebrow="Tile caches" title="Two caches, one ownership rule">
    <div style={{ display: 'flex', gap: 24 }}>
      <Card title="sharedTileCache" accent={teal}>Decoded upstream DEM tiles, float arrays + validity mask. Keyed on upstream URL + encoding. Saves the fetch and the decode: Slope after Hillshade downloads nothing.</Card>
      <Card title="tileResultCache">Finished protocol output, an ImageBitmap or MVT bytes. Keyed on the full protocol URL. 96 MB LRU. Saves the per-pixel work: toggling a mode off and on is instant.</Card>
    </div>
    <div style={{ display: 'flex', gap: 24, marginTop: 28 }}>
      <Card title="Clone both ways" accent={rose}>MapLibre transfers the ArrayBuffer to its worker and may close() a bitmap. Hand out the cache's own copy and the second hit throws DataCloneError. Clone before storing, clone before returning.</Card>
      <Card title="ImageBitmap, not PNG">convertToBlob(image/png) then MapLibre decodes it back: <span style={{ fontFamily: mono, color: 'var(--osd-text)' }}>99 ms</span> median per tile. createImageBitmap: <span style={{ fontFamily: mono, color: 'var(--osd-text)' }}>0.1 ms</span>. maplibre-gl-js #8515 / #8525.</Card>
      <Card title="For scale">Twelve Sky View Factor tiles at radius 32: ~1 s, in four workers. quantized-mesh:// went from ~1000 ms to 3-97 ms per tile; lerc:// from ~1100 to 66-233.</Card>
    </div>
    <div style={{ marginTop: 28 }}>
      <Code size={22}>{`const hit = lru.get(params.url)
if (hit) return { data: isBitmap(hit) ? await createImageBitmap(hit) : hit.slice() }
const result = await inner(params, abortController)
if (isBitmap(result.data)) put(params.url, await createImageBitmap(result.data))`}</Code>
    </div>
  </Frame>
);

const PerfRow = ({ k, before, now, gain }: { k: string; before: string; now: string; gain: string }) => (
  <div style={{ display: 'flex', gap: 20, padding: '11px 0', borderTop: `1px solid ${ink.rule}`, fontSize: 24, lineHeight: 1.3 }}>
    <span style={{ flex: 1, color: ink.text }}>{k}</span>
    <span style={{ width: 110, textAlign: 'right', fontFamily: mono, color: ink.muted }}>{before}</span>
    <span style={{ width: 110, textAlign: 'right', fontFamily: mono, color: ink.text }}>{now}</span>
    <span style={{ width: 90, textAlign: 'right', fontFamily: mono, color: teal }}>{gain}</span>
  </div>
);

const P11bPerf: Page = () => (
  <Frame eyebrow="Optimizations" title="Same pixels, several times sooner">
    <TwoCol
      leftWidth={760}
      left={
        <>
          <div style={{ display: 'flex', gap: 20, paddingBottom: 10, fontSize: 19, color: ink.muted }}>
            <span style={{ flex: 1 }}>ms per 512 px tile, Chrome, warm caches</span>
            <span style={{ width: 110, textAlign: 'right' }}>before</span>
            <span style={{ width: 110, textAlign: 'right' }}>now</span>
            <span style={{ width: 90, textAlign: 'right' }}>gain</span>
          </div>
          <PerfRow k="Blobness" before="212" now="8.0" gain="26x" />
          <PerfRow k="Hard Shadows, radius 16" before="297" now="12.6" gain="24x" />
          <PerfRow k="Openness, radius 8" before="894" now="94" gain="9.5x" />
          <PerfRow k="Local Relief Model" before="22.8" now="2.5" gain="9.1x" />
          <PerfRow k="Sky View Factor, radius 8" before="928" now="116" gain="8.0x" />
          <PerfRow k="DEM difference" before="35.5" now="7.4" gain="4.8x" />
          <PerfRow k="Curvature" before="25.4" now="6.0" gain="4.2x" />
          <PerfRow k="Slope" before="22.5" now="8.8" gain="2.6x" />
        </>
      }
      right={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Card title="Faster kernels" accent={teal}>Per-tile constants built once, no trigonometry in the inner loop, nothing allocated per pixel, one 32-bit store per pixel, scheduler.yield() instead of a clamped setTimeout.</Card>
          <Card title="Four worker pools">Raster compute, MapLibre (contours), GeoTIFF decoders, local COG contours: up to four workers each. Twelve heavy tiles land 3 to 4 times sooner, and no frame is missed.</Card>
          <Card title="Fewer requests" accent={rose}>Wayback walks eight releases at once (2.6 times faster). A DEM difference skips tiles its coarse operand lacks. Planet months are debounced: 45 tiles where 540 were asked.</Card>
        </div>
      }
    />
  </Frame>
);

const P12State: Page = () => (
  <Frame eyebrow="State and catalogs" title="The URL is the API, STAC is the inventory">
    <TwoCol
      leftWidth={900}
      left={
        <Bullets size={27}>
          <Li k="nuqs">everything shareable in the query string: camera, sources, modes, split, dates.</Li>
          <Li k="jotai atomWithStorage">what is personal: API keys, beta flags, folded sections.</Li>
          <Li k="Generated">url-params.json and openapi.json from QUERY_STATE_PARSERS; llms.txt and the skill on top.</Li>
          <Li k="STAC catalog">8 collections, every source with gsd, footprint, licence; tile services as web-map-links (xyz, wms, wmts).</Li>
          <Li k="MapLibre 6">ESM worker, render-to-texture drape of every custom raster, camera composed; skirts on the live GL meshes.</Li>
        </Bullets>
      }
      right={
        <Code size={21}>{`{
  "type": "Feature", "stac_version": "1.0.0",
  "id": "mapterhorn",
  "links": [{
    "rel": "xyz",
    "href": "https://…/{z}/{x}/{y}.webp",
    "terrain-viewer:encoding": "terrarium"
  }, {
    "rel": "alternate",
    "href": "https://terrain-viewer.iconem.com/?terrainSourceA=mapterhorn"
  }],
  "properties": { "gsd": 1, "license": "…" }
}`}</Code>
      }
    />
  </Frame>
);

const P12bTileService: Page = () => (
  <Frame eyebrow="Tile service" title="What the app draws, served as tiles over HTTP">
    <div style={{ display: 'flex', gap: 18, alignItems: 'stretch' }}>
      <Box accent={teal} w={330}>QGIS, MapLibre, CesiumJS,<br />Blender, GDAL</Box>
      <Arrow />
      <Box w={330}><span style={{ fontFamily: mono }}>tile-server/</span><br /><span style={{ color: dim, fontSize: 21 }}>port 3400, its API at /docs</span></Box>
      <Arrow />
      <Box accent={rose} w={420}>The app's code, run in Node<br /><span style={{ color: dim, fontSize: 21 }}>or the app itself in headless Chrome</span></Box>
    </div>
    <div style={{ marginTop: 32 }}>
      <Code size={22}>{`/terrain-tiles/{z}/{x}/{y}.png?terrainSource=mapterhorn&modes=slope,hillshade
/basemap-tiles/{z}/{x}/{y}.jpg?imagerySource=wayback&imageryDate=2020-01-01
/bbox/7.6,45.95,7.7,46/800x600.png      /render.png?lat=…&lng=…&zoom=…&viewMode=3d
/processes   /processes/slope   /sources   /colorramps   /qgis.qgz?<a share link's query>`}</Code>
    </div>
    <div style={{ display: 'flex', gap: 24, marginTop: 32 }}>
      <Card title="Every mode is a process" accent={teal}>OGC API – Processes, Part 1: each mode's settings as inputs with a JSON Schema. A process runs by asking for its tiles; POST execution answers 501 with the tile links.</Card>
      <Card title="The app's own words">Anything else in the query is an app URL parameter: ramps, opacities, light, radii. Modes stack in the map's order, never the order written.</Card>
      <Card title="Three ways to run it" accent={rose}>docker run -p 3400:3400 ghcr.io/iconem/terrain-viewer-tiles; the desktop app's local tile service; the QGIS plugin's Install button.</Card>
    </div>
  </Frame>
);

const EngineRow = ({ k, diff, direct, browser }: { k: string; diff: string; direct: string; browser: string }) => (
  <div style={{ display: 'flex', gap: 16, padding: '10px 0', borderTop: `1px solid ${ink.rule}`, fontSize: 23, lineHeight: 1.3 }}>
    <span style={{ flex: 1, color: ink.text }}>{k}</span>
    <span style={{ width: 80, textAlign: 'right', fontFamily: mono, color: ink.muted }}>{diff}</span>
    <span style={{ width: 120, textAlign: 'right', fontFamily: mono, color: teal }}>{direct}</span>
    <span style={{ width: 130, textAlign: 'right', fontFamily: mono, color: ink.muted }}>{browser}</span>
  </div>
);

const P12cEngines: Page = () => (
  <Frame eyebrow="Tile service · engines" title="The app's code in Node, or the app in a browser">
    <TwoCol
      leftWidth={800}
      left={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Card title="Direct: headless, Node + sharp" accent={teal}>Rebuilds the map's layer stack from the URL and computes each layer with the app's code bundled for Node: lib/*-protocol.ts, MapLibre's hillshade passes and the matcap and Phong shaders rewritten in JavaScript. Worker threads, one tile each.</Card>
          <Card title="Browser: the app in headless Chrome">For 3D, tilted, rotated and split views and the imagery. Opens the app on the 2048 px block that holds the tile, cuts it into 64 tiles, keeps them a week: 3 to 10 s, then under 0.1 s.</Card>
          <Card title="The same readers" accent={rose}>The app's protocols, registered in Node through the same registry: Terrarium, COG, VRT, WMS and WCS, LERC, PMTiles, quantized mesh, differences.</Card>
        </div>
      }
      right={
        <>
          <div style={{ display: 'flex', gap: 16, paddingBottom: 10, fontSize: 19, color: ink.muted }}>
            <span style={{ flex: 1 }}>Same tile drawn by both</span>
            <span style={{ width: 80, textAlign: 'right' }}>diff</span>
            <span style={{ width: 120, textAlign: 'right' }}>direct</span>
            <span style={{ width: 130, textAlign: 'right' }}>browser</span>
          </div>
          <EngineRow k="Hillshade (combined)" diff="0.9" direct="451 ms" browser="6290 ms" />
          <EngineRow k="Colour relief" diff="0.22" direct="53 ms" browser="3931 ms" />
          <EngineRow k="Slope" diff="0.02" direct="864 ms" browser="4607 ms" />
          <EngineRow k="Sky-view factor" diff="0.06" direct="855 ms" browser="5691 ms" />
          <EngineRow k="Local dominance" diff="0.09" direct="1112 ms" browser="5703 ms" />
          <EngineRow k="Cast shadows" diff="0" direct="228 ms" browser="4094 ms" />
          <EngineRow k="Contours" diff="2.13" direct="431 ms" browser="10951 ms" />
          <EngineRow k="LRM + SVF + hillshade" diff="1" direct="977 ms" browser="5699 ms" />
          <p style={{ fontSize: 20, color: dim, margin: '16px 0 0', lineHeight: 1.4 }}>Largest mean difference on 0–255 of four tiles, median times; 196 pairs at Matterhorn z12 and Paris z14 (2026-11-21). Each answer names its engine in x-tv-engine; x-tv-engine-why says why not the direct one.</p>
        </>
      }
    />
  </Frame>
);

const P12dOutputs: Page = () => (
  <Frame eyebrow="Tile service · outputs" title="Values, meshes and provenance, not only pictures">
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="Float32 values, for GDAL" accent={teal}>One mode before its ramp, in natural units: slope in degrees, SVF 0 to 1, curvature in 1/m. NaN for no data, deflate with the float predictor. /gdal.xml is the whole world as one raster with overviews.</Card>
        <Code size={19}>{`/terrain-tiles/{z}/{x}/{y}.tif?modes=slope
gdalinfo "http://localhost:3400/gdal.xml?modes=svf"`}</Code>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="Quantized mesh, for 3D">Any source the direct engine reads, as quantized-mesh-1.0 with vertex normals, for CesiumJS and Blender. delatin by default (about 45 % fewer triangles), martini three to four times faster to make.</Card>
        <Code size={19}>{`/quantized-mesh/mapterhorn/layer.json
  ?mesher=martini&maxTriangles=8000`}</Code>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card title="A STAC Item per export" accent={rose}>STAC 1.1.0 with the Processing extension: the lineage, the software version, the processes and inputs as run, derived_from the source. Worked out from the address alone; API keys left out.</Card>
        <Code size={19}>{`…/13/4270/2911.tif.stac.json?modes=slope
Link: <….stac.json>; rel="describedby"`}</Code>
      </div>
    </div>
    <div style={{ display: 'flex', gap: 32, marginTop: 40 }}>
      <Stat n="141" label="terrain sources at /sources, built-in and library" />
      <Stat n="268" label="colour ramps at /colorramps" />
      <Stat n="2–6 ms" label="to compress a 256 px value tile, beside 10–20 ms of slope" />
      <Stat n="~1,000/s" label="cached mesh tiles served, kept gzipped" />
    </div>
  </Frame>
);

const P13Close: Page = () => (
  <Closing
    title={
      <>
        Register it once.
        <br />
        <span style={{ color: 'var(--osd-accent)' }}>Every mode gets it.</span>
      </>
    }
    lines={[
      'terrain-viewer.iconem.com/docs/dev/custom-protocols',
      'terrain-viewer.iconem.com/docs/dev/equations',
      'terrain-viewer.iconem.com/docs/dev/terrain-analysis-pipeline',
      'terrain-viewer.iconem.com/docs/dev/tile-caches',
      'terrain-viewer.iconem.com/docs/dev/tile-service',
    ]}
  />
);

export const notes: (string | undefined)[] = [
  'The engineering deck: how tiles become derivatives in the browser, and the registry and caches that keep it fast.',
  'A custom protocol is a function MapLibre calls per tile. Eleven modes share this pipeline; the derivative is packed as pseudo-elevation and MapLibre colours it.',
  'Decoding and the Horn gradient are shared by everything. Ported line by line from GDAL.',
  'Curvature is one second-order fit read five ways. The structure tensor needs a 5×5 halo.',
  'SVF and openness march the horizon in eight directions. A max cannot be coarsened; a mean can, which is why local dominance can use the pyramid.',
  'LRM subtracts an ancestor tile. The half-pixel correction removed a slope-correlated bias.',
  'Lighting starts from a real normal on the GPU. The live path exists for view-dependent terms.',
  `Hard Shadows now has a live GPU renderer, the default. Each pixel marches one ray toward the sun over a Float32 mosaic of the view, then over the same terrain three zooms coarser: tens of kilometres at zoom 13, hundreds at zoom 11.
Two corrections matter at that range. The Earth curves away: 690 m of drop at 100 km, refraction included. Under a 1.5 degree sunset the Alps' shadow over the Po plain is 87 km, not the 107 a flat Earth gives.
And the sun is a disc, 0.53 degrees: the edge softens by about 9 m per kilometre of shadow. It only shows on long shadows or close up.`,
  'Source protocols read what MapLibre cannot and hand back Terrarium.',
  'Derived modes read any source scheme. The URL carries every parameter, so the cache key is always right.',
  'The registry: one place to register, one way to fetch. Twice a scheme was missed before it existed.',
  'Two caches, and the rule: clone on both sides, return an ImageBitmap.',
  'November 2026: every per-pixel loop rewritten for the same output, then the heavy ones moved to workers. A worker does not make a tile faster; it lets several compute at once and keeps the page drawing.',
  'nuqs for the URL, jotai for the personal; the parameter list and the STAC catalog are generated from the code.',
  `The app has no server, but other tools want what it draws. The tile service is that: one small server, one address per kind of answer, and every mode described as an OGC API Processes process.
Running a process means asking for its tiles: a tile is milliseconds of work asked hundreds of times, which a job queue would only slow down. Run it from Docker, from the desktop app, or let the QGIS plugin install it.`,
  `Two engines. The direct one is the app's own protocol code bundled for Node, with sharp for the image files: no browser, a tile in tens to hundreds of milliseconds. The browser engine opens the real app in headless Chrome for what only the app draws: 3D, splits, imagery.
The table is the check: the same tiles drawn by both, a mean difference of 1 on 255 or less for most modes.`,
  'Not only pictures. Float32 values a GIS can compute on, through GDAL; Cesium terrain for CesiumJS and Blender, from any source the direct engine reads; and a STAC Item for every export saying what made it.',
  'Read the dev pages; every formula there is transcribed from its protocol file.',
];

export const meta: SlideMeta = {
  title: 'Under the hood',
  createdAt: '2026-10-05T13:22:28.903Z',
};

export default [
  P1Cover,
  P2Pipeline,
  P3Decode,
  P4Curvature,
  P5Horizon,
  P6Lrm,
  P7Lighting,
  P7bShadows,
  P8SourceProtocols,
  P9VizProtocols,
  P10Registry,
  P11Caches,
  P11bPerf,
  P12State,
  P12bTileService,
  P12cEngines,
  P12dOutputs,
  P13Close,
] satisfies Page[];
