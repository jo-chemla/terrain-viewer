"use client";

// The demo videos, served from the demo-takes GitHub release (an MP4 is 30 to
// 100 MB, too heavy for the docs deploy): the narrated cut first, then the raw
// takes it was cut from. One entry per take family and one per cut.
// A video is mounted with preload="none" behind its poster, so the page costs
// nothing until a play button is pressed; the browser then streams the asset
// by byte ranges (the release host accepts them). The release keeps only the
// current cut and takes; a superseded recording is deleted when a new one lands.
//
// The posters are frames of the videos, written by video/scripts/posters.sh
// into docs/public/screenshots/videos/.
import { useState } from "react";

const RELEASE = "https://github.com/Iconem/terrain-viewer/releases/download/demo-takes/";
const TAKES = "https://github.com/Iconem/terrain-viewer/tree/main/video/takes/";

type Video = {
  id: string;
  file: string;
  title: string;
  seconds: number;
  recorded: string;
  about: string;
  scripts?: string;
  cut?: string;
};

export const CUT: Video = {
  id: "demo-v5",
  file: "terrain-viewer-demo-v5-2026-10-14.mp4",
  title: "Terrain Viewer, the demo",
  seconds: 145,
  recorded: "2026-10-14",
  about: "The two takes below with title cards and a narrator's subtitles: slope and hypsometric tint over Mont Blanc, then the historical imagery of the Champ de Mars on a timeline, in a grid, matched and blended.",
  cut: "https://github.com/Iconem/terrain-viewer/blob/main/video/src/Demo5.tsx",
};

export const RAW: Video[] = [
  {
    id: "basic-modes-v8",
    file: "basic-modes-v8-2026-10-14.mp4",
    title: "Basic modes over Mont Blanc",
    seconds: 51,
    recorded: "2026-10-14",
    about: "Hillshade, then slope with its range narrowed to 60 degrees, the hypsometric tint with another ramp and its bounds pulled in, then fitted to the view, a zoom, and the picker of visualization modes.",
    scripts: "basic-modes-v8",
  },
  {
    id: "historical-grid-v5",
    file: "historical-grid-v5-2026-10-14.mp4",
    title: "Historical imagery of the Champ de Mars",
    seconds: 84,
    recorded: "2026-10-14",
    about: "Esri Wayback 2024 with a pan; the overlay swipe against Bing; three more dates from the timeline; six dated views in a grid, two of them re-dated by their handles, sorted by date; Match Colors on and off; the Difference blend, its divider swept to the edge.",
    scripts: "historical-grid-v5",
  },
];

const linkClass = "font-medium underline underline-offset-4 decoration-fd-primary/40 hover:decoration-fd-primary";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function Player({ v }: { v: Video }) {
  const [on, setOn] = useState(false);
  // Absolute with the /docs basePath by hand (a plain <img src> never gets it from Next): the player is on the home page too, where a page-relative path would miss.
  const poster = `/docs/screenshots/videos/${v.id}.jpg`;
  return (
    <div className="not-prose my-4">
      <div className="relative aspect-video overflow-hidden rounded-lg border bg-black">
        {on ? (
          <video className="h-full w-full" src={RELEASE + v.file} poster={poster} controls autoPlay playsInline preload="none" />
        ) : (
          <button type="button" onClick={() => setOn(true)} className="group block h-full w-full cursor-pointer" aria-label={`Play ${v.title}`}>
            <img src={poster} alt={v.title} className="h-full w-full object-cover" loading="lazy" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-black shadow transition group-hover:scale-105">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </span>
          </button>
        )}
      </div>
      <p className="mt-2 text-sm text-fd-muted-foreground">
        {v.title} · {mmss(v.seconds)} · 1920 × 1080, 30 fps · recorded {v.recorded} ·{" "}
        <a className={linkClass} href={RELEASE + v.file}>download</a>
        {v.scripts && (
          <>
            {" "}· <a className={linkClass} href={TAKES + v.scripts}>scripts</a>
          </>
        )}
        {v.cut && (
          <>
            {" "}· <a className={linkClass} href={v.cut}>the cut</a>
          </>
        )}
      </p>
    </div>
  );
}

// Screencasts recorded by hand, not by the pipeline: a .mov from the desktop,
// converted to 1080p-class 30 fps MP4 with ffmpeg and put on the same release.
export const MANUAL: Video[] = [
  {
    id: "draw-before-after-coastline",
    file: "draw-before-after-coastline-2026-10-15.mp4",
    title: "A coastline before and after, traced",
    seconds: 119,
    recorded: "2026-10-15",
    about: "By hand, in Historical Satellite: Google Earth 2011 against Esri 2025 in the overlay with Match Colors, then the old shoreline traced as a line with the Drawing tool and the divider swiped across it, so the reclaimed land reads at a glance.",
  },
];

export function DemoManual() {
  return (
    <div>
      {MANUAL.map((v) => (
        <div key={v.id} className="my-8">
          <h3 className="mb-1 text-lg font-semibold">{v.title}</h3>
          <p className="my-0 text-sm text-fd-muted-foreground">{v.about}</p>
          <Player v={v} />
        </div>
      ))}
    </div>
  );
}

export function DemoCut() {
  return <Player v={CUT} />;
}

export function DemoTakes() {
  return (
    <div>
      {RAW.map((v) => (
        <div key={v.id} className="my-8">
          <h3 className="mb-1 text-lg font-semibold">{v.title}</h3>
          <p className="my-0 text-sm text-fd-muted-foreground">{v.about}</p>
          <Player v={v} />
        </div>
      ))}
    </div>
  );
}
