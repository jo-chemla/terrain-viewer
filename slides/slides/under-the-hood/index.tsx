import { type DesignSystem, type Page, type SlideMeta, Step, Steps, useSlidePageNumber } from '@open-slide/core';
import type { CSSProperties, ReactNode } from 'react';

import slope from '@assets/screenshots/viz-modes/slope.jpg';
import phong from '@assets/screenshots/viz-modes/phong.jpg';
import hardShadows from '@assets/screenshots/viz-modes/hard-shadows.jpg';
import matcap from '@assets/screenshots/viz-modes/matcap.jpg';
import lrmR64 from '@assets/screenshots/viz-modes/lrm-r64.jpg';
import sourceInfo from '@assets/screenshots/terrain-source-info.jpg';

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

const DECK = 'Under the hood';
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
        <span style={{ color: 'var(--osd-accent)' }}>▲</span> Terrain Viewer · {DECK} · terrain-viewer.iconem.com/docs/dev
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

const Formula = ({ label, children }: { label?: ReactNode; children: ReactNode }) => (
  <div style={{ marginBottom: 18 }}>
    {label ? <div style={{ fontSize: 22, color: 'var(--osd-accent)', fontWeight: 600, marginBottom: 8, letterSpacing: '0.04em' }}>{label}</div> : null}
    <div
      style={{
        fontFamily: mono,
        fontSize: 28,
        background: 'rgba(0,0,0,0.35)',
        border: `1px solid ${rule}`,
        borderRadius: 12,
        padding: '16px 24px',
        color: '#dbe4f3',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      }}
    >
      {children}
    </div>
  </div>
);

const Scheme = ({ s, what, accent = 'var(--osd-accent)' }: { s: string; what: ReactNode; accent?: string }) => (
  <div style={{ display: 'flex', gap: 22, alignItems: 'baseline', padding: '8px 0', borderBottom: `1px solid ${rule}` }}>
    <span style={{ fontFamily: mono, fontSize: 25, color: accent, width: 330, flex: 'none' }}>{s}</span>
    <span style={{ fontSize: 23, color: muted, lineHeight: 1.3 }}>{what}</span>
  </div>
);

const Box = ({ children, accent = 'var(--osd-accent)', w = 300 }: { children: ReactNode; accent?: string; w?: number }) => (
  <div
    style={{
      width: w,
      flex: 'none',
      background: panel,
      border: `1px solid ${rule}`,
      borderLeft: `5px solid ${accent}`,
      borderRadius: 10,
      padding: '16px 20px',
      fontSize: 24,
      lineHeight: 1.35,
      textAlign: 'center',
    }}
  >
    {children}
  </div>
);

const Arrow = () => <div style={{ color: dim, fontSize: 36, alignSelf: 'center', flex: 'none' }}>→</div>;

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
      terrain-viewer.iconem.com/docs/dev · lib/*-protocol.ts
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
          <Scheme s="dem-contour://" what="maplibre-contour's own worker, fed through the registry" accent={teal} />
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
          <Scheme s="tells:// threshold://" what="mound candidates as vector tiles; iso-line and fill" accent={rose} />
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
      <Card title="For scale">LRM over a z13 viewport: ~1.2 s of recompute. quantized-mesh:// went from ~1000 ms to 3-97 ms per tile; lerc:// from ~1100 to 66-233.</Card>
    </div>
    <div style={{ marginTop: 28 }}>
      <Code size={22}>{`const hit = lru.get(params.url)
if (hit) return { data: isBitmap(hit) ? await createImageBitmap(hit) : hit.slice() }
const result = await inner(params, abortController)
if (isBitmap(result.data)) put(params.url, await createImageBitmap(result.data))`}</Code>
    </div>
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
  'Source protocols read what MapLibre cannot and hand back Terrarium.',
  'Derived modes read any source scheme. The URL carries every parameter, so the cache key is always right.',
  'The registry: one place to register, one way to fetch. Twice a scheme was missed before it existed.',
  'Two caches, and the rule: clone on both sides, return an ImageBitmap.',
  'nuqs for the URL, jotai for the personal; the parameter list and the STAC catalog are generated from the code.',
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
  P8SourceProtocols,
  P9VizProtocols,
  P10Registry,
  P11Caches,
  P12State,
  P13Close,
] satisfies Page[];
