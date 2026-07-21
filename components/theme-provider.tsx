import { createContext, useContext, useEffect, useState } from "react";
import { allThemeValues, DEFAULT_THEME } from "@/lib/themes-config";
import { useTheme as useAppTheme } from "@/lib/controls-utils";

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

const initialState: ThemeProviderState = {
  theme: DEFAULT_THEME,
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

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
  const [colorName, setColorName] = useState<string>(() => {
    const stored =
      typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    // Strips a stale "-light"/"-dark" suffix in case an earlier version of this
    // integration stored the full combined string.
    return (stored || defaultTheme).replace(/-(light|dark)$/, "");
  });

  const theme = `${colorName}-${appTheme}`;

  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (colorName: string) => {
    const bareName = colorName.replace(/-(light|dark)$/, "");
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
