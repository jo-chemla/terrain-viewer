import { createContext, useContext, useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { allThemeValues, DEFAULT_THEME, themeNames } from "@/lib/themes-config";
import { useTheme as useAppTheme } from "@/lib/controls-utils";
import { customThemesAtom } from "@/lib/settings-atoms";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: string;
  storageKey?: string;
};

type ThemeProviderState = {
  // Full "<colorName>-<light|dark>" string (e.g. "cyberpunk-dark") — kept in this
  // shape since every [data-theme="…"] CSS block in src/styles/themes/ expects it.
  theme: string;
  // Takes just the color-preset name (see ColorThemeSelect in theme-switcher.tsx) —
  // the light/dark half is never set here, only ever read from the app's own toggle.
  setTheme: (colorName: string) => void;
};

const DEFAULT_COLOR_NAME = DEFAULT_THEME.replace(/-(light|dark)$/, "");

// A handful of preset names legitimately end in "-light"/"-dark" themselves
// (e.g. "sandstone-light", sourced verbatim from shadcnthemes.app) — stripping
// a trailing "-light"/"-dark" unconditionally would truncate those down to a
// nonexistent bare name ("sandstone"), silently falling back to the default
// theme. Only strip when the raw value ISN'T already a known preset name —
// that's the one case (a stale "<name>-<mode>" combined string from an older
// version of this integration) the strip is actually meant to clean up.
function stripStaleModeSuffix(raw: string): string {
  if (themeNames.includes(raw)) return raw;
  return raw.replace(/-(light|dark)$/, "");
}

const initialState: ThemeProviderState = {
  theme: DEFAULT_THEME,
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

const CUSTOM_THEMES_STYLE_ID = "custom-themes-style";

// Custom themes saved from the theme-editor package's "Save" button (see
// settings-dialog.tsx's onSaveTheme) live in localStorage as raw CSS text
// (customThemesAtom, lib/settings-atoms.ts), not as data this component
// understands — this just concatenates and injects them as a <style> tag so
// their `[data-theme="<name>-light"]`/`[data-theme="<name>-dark"]` rules
// exist in the DOM before ColorThemeSelect (or a reload restoring one from
// localStorage) ever tries to select one.
function useInjectCustomThemes() {
  const customThemes = useAtomValue(customThemesAtom);
  useEffect(() => {
    let style = document.getElementById(CUSTOM_THEMES_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = CUSTOM_THEMES_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = customThemes.map((t) => t.css).join("\n\n");
  }, [customThemes]);
}

// Only the color preset (e.g. "cyberpunk") is stored/tracked here — the light/dark
// half of the theme string is always derived live from the app's OWN theme toggle
// (Settings > Appearance > Theme, useTheme() in controls-utils.tsx) rather than
// being an independent piece of state. This is the fix for tweakcn "not reacting"
// to that toggle: it used to hold its own separate "<name>-<mode>" string, set once
// via its own (now-removed) light/dark menu items, with nothing connecting it to
// the app's existing toggle at all.
export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_COLOR_NAME,
  storageKey = "tweakcn-theme",
  ...props
}: ThemeProviderProps) {
  const { theme: appTheme } = useAppTheme();
  useInjectCustomThemes();
  const [colorName, setColorName] = useState<string>(() => {
    const stored =
      typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    return stripStaleModeSuffix(stored || defaultTheme);
  });

  const theme = `${colorName}-${appTheme}`;

  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (colorName: string) => {
    const bareName = stripStaleModeSuffix(colorName);
    localStorage.setItem(storageKey, bareName);
    setColorName(bareName);
  };

  const value = { theme, setTheme };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};

// Re-export theme values for convenience
export { allThemeValues, DEFAULT_THEME };
