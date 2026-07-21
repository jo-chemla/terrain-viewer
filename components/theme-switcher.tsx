import type React from "react";
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sortedThemes } from "@/lib/themes-config";
import { customThemesAtom, type CustomTheme } from "@/lib/settings-atoms";
import { useTheme } from "@/components/theme-provider";
import { parseColorToOklch, oklchToHex } from "@/theme-editor";

// Custom themes are stored as raw CSS text (see settings-dialog.tsx's
// onSaveTheme / theme-provider.tsx's injector) rather than a parsed value
// map, so a swatch preview color has to be pulled back out of that text —
// good enough for a small dropdown swatch, not meant for anything more.
function extractPrimaryHex(css: string, mode: "light" | "dark"): string | null {
  const match = css.match(new RegExp(`\\[data-theme="[^"]*-${mode}"\\][^}]*?--primary:\\s*([^;]+);`, "s"));
  if (!match) return null;
  try { return oklchToHex(parseColorToOklch(match[1].trim())); } catch { return null; }
}

// Color-preset picker only, no light/dark control of its own — mode always
// follows whatever Settings > Appearance > Theme is already set to (see
// theme-provider.tsx, which derives it from that toggle instead of tracking
// an independent one here). Lists the built-in tweakcn presets, then any
// themes saved locally via the advanced theme-editor's "Save" button, after
// a separator.
export function ColorThemeSelect() {
  const { theme, setTheme } = useTheme();
  const rawCustomThemes = useAtomValue(customThemesAtom);
  const colorName = theme.replace(/-(light|dark)$/, "");
  const isDark = theme.endsWith("-dark");

  // Defensive filter against any theme saved before the name-collision guard
  // in settings-dialog.tsx's onSaveTheme existed — a custom entry sharing a
  // built-in's exact name would otherwise mean two <SelectItem>s with the
  // same value, and its CSS block would collide with the real preset's own
  // [data-theme="…"] rule.
  const customThemes = useMemo(
    () => rawCustomThemes.filter((t) => !sortedThemes.some((b) => b.name === t.name)),
    [rawCustomThemes],
  );

  const customSwatch = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const t of customThemes) map.set(t.name, extractPrimaryHex(t.css, isDark ? "dark" : "light"));
    return map;
  }, [customThemes, isDark]);

  const builtIn = sortedThemes.find((t) => t.name === colorName);
  const custom = !builtIn ? customThemes.find((t) => t.name === colorName) : undefined;
  const currentTitle = builtIn?.title ?? custom?.name ?? sortedThemes[0].title;
  const currentSwatch = builtIn ? (isDark ? builtIn.primaryDark : builtIn.primaryLight) : (custom ? customSwatch.get(custom.name) ?? "#888" : sortedThemes[0].primaryLight);

  // Cycling order matches the dropdown's own visual order: built-ins first,
  // then saved custom themes after the separator.
  const orderedNames = useMemo(() => [...sortedThemes.map((t) => t.name), ...customThemes.map((t) => t.name)], [customThemes]);

  // Radix's SelectTrigger opens the popup on ArrowUp/ArrowDown by default (see
  // OPEN_KEYS in @radix-ui/react-select) — preventDefault here runs BEFORE that
  // (composeEventHandlers calls the caller's onKeyDown first and skips its own
  // handler if the event was prevented), so arrow keys instead just step the
  // selection directly, like a native <select> closed-popup keyboard behavior.
  const step = (delta: number) => {
    const index = orderedNames.indexOf(colorName);
    const next = orderedNames[Math.min(Math.max(index + delta, 0), orderedNames.length - 1)];
    if (next) setTheme(next);
  };
  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); step(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); step(-1); }
  };

  return (
    <Select value={colorName} onValueChange={setTheme}>
      <SelectTrigger className="w-full cursor-pointer" onKeyDown={handleTriggerKeyDown}>
        <SelectValue>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: currentSwatch ?? undefined }} />
            <span>{currentTitle}</span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {sortedThemes.map((t) => (
          <SelectItem key={t.name} value={t.name}>
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: isDark ? t.primaryDark : t.primaryLight }}
              />
              <span>{t.title}</span>
            </div>
          </SelectItem>
        ))}
        {customThemes.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Custom</SelectLabel>
              {customThemes.map((t: CustomTheme) => (
                <SelectItem key={t.name} value={t.name}>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: customSwatch.get(t.name) ?? "#888" }} />
                    <span>{t.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
