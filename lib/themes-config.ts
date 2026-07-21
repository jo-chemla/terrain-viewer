export interface ThemeConfig {
  name: string;
  title: string;
  primaryLight: string;
  primaryDark: string;
  fontSans: string;
  /** Which site this preset was sourced from, for grouping in the picker —
   *  undefined means "tweakcn" (the original 42 + these additions all came
   *  from tweakcn.com's own utils/theme-presets.ts, extracted directly
   *  rather than guessed, same as every other preset already here). */
  source?: "tweakcn" | "themux" | "shadcnthemes";
}

export const themes: ThemeConfig[] = [
  {
    name: "default",
    title: "Default",
    primaryLight: "oklch(0.2050 0 0)",
    primaryDark: "oklch(0.9220 0 0)",
    fontSans: "ui-sans-serif, system-ui, sans-serif",
  },
  {
    name: "amber-minimal",
    title: "Amber Minimal",
    primaryLight: "oklch(0.77 0.16 70.08)",
    primaryDark: "oklch(0.77 0.16 70.08)",
    fontSans: "Inter, sans-serif",
  },
  {
    name: "bold-tech",
    title: "Bold Tech",
    primaryLight: "oklch(0.61 0.22 292.72)",
    primaryDark: "oklch(0.61 0.22 292.72)",
    fontSans: "Roboto, sans-serif",
  },
  {
    name: "bubblegum",
    title: "Bubblegum",
    primaryLight: "oklch(0.62 0.18 348.14)",
    primaryDark: "oklch(0.92 0.08 87.67)",
    fontSans: "Poppins, sans-serif",
  },
  {
    name: "caffeine",
    title: "Caffeine",
    primaryLight: "oklch(0.43 0.04 41.99)",
    primaryDark: "oklch(0.92 0.05 66.17)",
    fontSans: "system-ui, sans-serif",
  },
  {
    name: "candyland",
    title: "Candyland",
    primaryLight: "oklch(0.87 0.07 7.09)",
    primaryDark: "oklch(0.8 0.14 349.23)",
    fontSans: "Poppins, sans-serif",
  },
  {
    name: "catppuccin",
    title: "Catppuccin",
    primaryLight: "oklch(0.55 0.25 297.02)",
    primaryDark: "oklch(0.79 0.12 304.77)",
    fontSans: "Montserrat, sans-serif",
  },
  {
    name: "claude",
    title: "Claude",
    primaryLight: "oklch(0.62 0.14 39.04)",
    primaryDark: "oklch(0.67 0.13 38.76)",
    fontSans: "system-ui, sans-serif",
  },
  {
    name: "claymorphism",
    title: "Claymorphism",
    primaryLight: "oklch(0.59 0.2 277.12)",
    primaryDark: "oklch(0.68 0.16 276.93)",
    fontSans: "Plus Jakarta Sans, sans-serif",
  },
  {
    name: "clean-slate",
    title: "Clean Slate",
    primaryLight: "oklch(0.59 0.2 277.12)",
    primaryDark: "oklch(0.68 0.16 276.93)",
    fontSans: "Inter, sans-serif",
  },
  {
    name: "cosmic-night",
    title: "Cosmic Night",
    primaryLight: "oklch(0.54 0.18 288.03)",
    primaryDark: "oklch(0.72 0.16 290.40)",
    fontSans: "Inter, sans-serif",
  },
  {
    name: "cyberpunk",
    title: "Cyberpunk",
    primaryLight: "oklch(0.67 0.29 341.41)",
    primaryDark: "oklch(0.67 0.29 341.41)",
    fontSans: "Outfit, sans-serif",
  },
  {
    name: "doom-64",
    title: "Doom 64",
    primaryLight: "oklch(0.5 0.19 27.48)",
    primaryDark: "oklch(0.61 0.21 27.03)",
    fontSans: "Oxanium, sans-serif",
  },
  {
    name: "elegant-luxury",
    title: "Elegant Luxury",
    primaryLight: "oklch(0.47 0.15 24.94)",
    primaryDark: "oklch(0.51 0.19 27.52)",
    fontSans: "Poppins, sans-serif",
  },
  {
    name: "graphite",
    title: "Graphite",
    primaryLight: "oklch(0.49 0 0)",
    primaryDark: "oklch(0.71 0 0)",
    fontSans: "Inter, sans-serif",
  },
  {
    name: "kodama-grove",
    title: "Kodama Grove",
    primaryLight: "oklch(0.67 0.11 118.91)",
    primaryDark: "oklch(0.68 0.06 132.45)",
    fontSans: "Merriweather, serif",
  },
  {
    name: "midnight-bloom",
    title: "Midnight Bloom",
    primaryLight: "oklch(0.57 0.20 283.08)",
    primaryDark: "oklch(0.57 0.20 283.08)",
    fontSans: "Montserrat, sans-serif",
  },
  {
    name: "mocha-mousse",
    title: "Mocha Mousse",
    primaryLight: "oklch(0.61 0.06 44.36)",
    primaryDark: "oklch(0.73 0.05 52.33)",
    fontSans: "DM Sans, sans-serif",
  },
  {
    name: "modern-minimal",
    title: "Modern Minimal",
    primaryLight: "oklch(0.62 0.19 259.81)",
    primaryDark: "oklch(0.62 0.19 259.81)",
    fontSans: "Inter, sans-serif",
  },
  {
    name: "mono",
    title: "Mono",
    primaryLight: "oklch(0.56 0 0)",
    primaryDark: "oklch(0.56 0 0)",
    fontSans: "Geist Mono, monospace",
  },
  {
    name: "nature",
    title: "Nature",
    primaryLight: "oklch(0.52 0.13 144.17)",
    primaryDark: "oklch(0.67 0.16 144.21)",
    fontSans: "Montserrat, sans-serif",
  },
  {
    name: "neo-brutalism",
    title: "Neo Brutalism",
    primaryLight: "oklch(0.65 0.24 26.97)",
    primaryDark: "oklch(0.70 0.19 23.19)",
    fontSans: "DM Sans, sans-serif",
  },
  {
    name: "northern-lights",
    title: "Northern Lights",
    primaryLight: "oklch(0.65 0.15 150.31)",
    primaryDark: "oklch(0.65 0.15 150.31)",
    fontSans: "Plus Jakarta Sans, sans-serif",
  },
  {
    name: "ocean-breeze",
    title: "Ocean Breeze",
    primaryLight: "oklch(0.72 0.19 149.58)",
    primaryDark: "oklch(0.77 0.15 163.22)",
    fontSans: "DM Sans, sans-serif",
  },
  {
    name: "pastel-dreams",
    title: "Pastel Dreams",
    primaryLight: "oklch(0.71 0.16 293.54)",
    primaryDark: "oklch(0.79 0.12 295.75)",
    fontSans: "Open Sans, sans-serif",
  },
  {
    name: "perpetuity",
    title: "Perpetuity",
    primaryLight: "oklch(0.56 0.09 203.28)",
    primaryDark: "oklch(0.85 0.13 195.04)",
    fontSans: "Courier New, monospace",
  },
  {
    name: "quantum-rose",
    title: "Quantum Rose",
    primaryLight: "oklch(0.6 0.24 0.13)",
    primaryDark: "oklch(0.75 0.23 332.02)",
    fontSans: "Poppins, sans-serif",
  },
  {
    name: "retro-arcade",
    title: "Retro Arcade",
    primaryLight: "oklch(0.59 0.2 355.89)",
    primaryDark: "oklch(0.59 0.2 355.89)",
    fontSans: "Outfit, sans-serif",
  },
  {
    name: "solar-dusk",
    title: "Solar Dusk",
    primaryLight: "oklch(0.56 0.15 49)",
    primaryDark: "oklch(0.7 0.19 47.6)",
    fontSans: "Oxanium, sans-serif",
  },
  {
    name: "starry-night",
    title: "Starry Night",
    primaryLight: "oklch(0.48 0.12 263.38)",
    primaryDark: "oklch(0.48 0.12 263.38)",
    fontSans: "Libre Baskerville, serif",
  },
  {
    name: "supabase",
    title: "Supabase",
    primaryLight: "oklch(0.83 0.13 160.91)",
    primaryDark: "oklch(0.44 0.1 156.76)",
    fontSans: "Outfit, sans-serif",
  },
  {
    name: "sunset-horizon",
    title: "Sunset Horizon",
    primaryLight: "oklch(0.74 0.16 34.71)",
    primaryDark: "oklch(0.74 0.16 34.71)",
    fontSans: "Montserrat, sans-serif",
  },
  {
    name: "t3-chat",
    title: "T3 Chat",
    primaryLight: "oklch(0.53 0.14 355.2)",
    primaryDark: "oklch(0.46 0.19 4.1)",
    fontSans: "system-ui, sans-serif",
  },
  {
    name: "tangerine",
    title: "Tangerine",
    primaryLight: "oklch(0.64 0.17 36.44)",
    primaryDark: "oklch(0.64 0.17 36.44)",
    fontSans: "Inter, sans-serif",
  },
  {
    name: "twitter",
    title: "Twitter",
    primaryLight: "oklch(0.67 0.16 245)",
    primaryDark: "oklch(0.67 0.16 245.01)",
    fontSans: "Open Sans, sans-serif",
  },
  {
    name: "vercel",
    title: "Vercel",
    primaryLight: "oklch(0 0 0)",
    primaryDark: "oklch(1 0 0)",
    fontSans: "Geist, sans-serif",
  },
  {
    name: "vintage-paper",
    title: "Vintage Paper",
    primaryLight: "oklch(0.62 0.08 65.54)",
    primaryDark: "oklch(0.73 0.06 66.7)",
    fontSans: "Libre Baskerville, serif",
  },
  {
    name: "twitch",
    title: "Twitch",
    primaryLight: "oklch(0.54 0.24 292)",
    primaryDark: "oklch(0.60 0.22 292)",
    fontSans: "Inter, sans-serif",
  },
  {
    name: "kick",
    title: "Kick",
    primaryLight: "oklch(0.75 0.26 135)",
    primaryDark: "oklch(0.83 0.28 135)",
    fontSans: "Inter, sans-serif",
  },
  {
    name: "spotify",
    title: "Spotify",
    primaryLight: "oklch(0.64 0.20 155)",
    primaryDark: "oklch(0.68 0.20 155)",
    fontSans: "Montserrat, sans-serif",
  },
  {
    name: "stripe",
    title: "Stripe",
    primaryLight: "oklch(0.55 0.24 280)",
    primaryDark: "oklch(0.65 0.22 280)",
    fontSans: "system-ui, sans-serif",
  },
  {
    name: "github",
    title: "GitHub",
    primaryLight: "oklch(0.52 0.16 145)",
    primaryDark: "oklch(0.62 0.16 145)",
    fontSans: "system-ui, sans-serif",
  },
  {
    name: "windows98",
    title: "Windows 98",
    primaryLight: "oklch(0.2711 0.1879 264.0520)",
    primaryDark: "oklch(0.2711 0.1879 264.0520)",
    fontSans: "Pixelify Sans, sans-serif",
  },
  {
    name: "violet-bloom",
    title: "Violet Bloom",
    primaryLight: "oklch(0.5393 0.2713 286.75)",
    primaryDark: "oklch(0.6132 0.2294 291.74)",
    fontSans: "Plus Jakarta Sans, sans-serif",
  },
  {
    name: "amethyst-haze",
    title: "Amethyst Haze",
    primaryLight: "oklch(0.6104 0.0767 299.73)",
    primaryDark: "oklch(0.7058 0.0777 302.05)",
    fontSans: "Geist, sans-serif",
  },
  {
    name: "notebook",
    title: "Notebook",
    primaryLight: "oklch(0.4891 0 89.88)",
    primaryDark: "oklch(0.7572 0 89.88)",
    fontSans: "Architects Daughter, sans-serif",
  },
  {
    name: "darkmatter",
    title: "Darkmatter",
    primaryLight: "oklch(0.6716 0.1368 48.51)",
    primaryDark: "oklch(0.7214 0.1337 49.98)",
    fontSans: "Geist Mono, ui-monospace, monospace",
  },
  {
    name: "soft-pop",
    title: "Soft Pop",
    primaryLight: "oklch(0.5106 0.2301 276.97)",
    primaryDark: "oklch(0.6801 0.1583 276.93)",
    fontSans: "DM Sans, sans-serif",
  },
  {
    name: "sage-garden",
    title: "Sage Garden",
    primaryLight: "oklch(0.6333 0.0309 154.9)",
    primaryDark: "oklch(0.6333 0.0309 154.9)",
    fontSans: "Antic, ui-sans-serif, sans-serif, system-ui",
  },
];

// Sort themes alphabetically by title, but keep default first
export const sortedThemes = [
  themes[0],
  ...themes.slice(1).sort((a, b) => a.title.localeCompare(b.title)),
];

export const themeNames = themes.map((t) => t.name);

// Generate all theme values for next-themes (name-light and name-dark variants)
export const allThemeValues = themes.flatMap((t) => [
  `${t.name}-light`,
  `${t.name}-dark`,
]);

// Default theme
export const DEFAULT_THEME = "default-dark";
