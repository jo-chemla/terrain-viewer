import type React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sortedThemes } from "@/lib/themes-config";
import { useTheme } from "@/components/theme-provider";

// Color-preset picker only, no light/dark control of its own — mode always
// follows whatever Settings > Appearance > Theme is already set to (see
// theme-provider.tsx, which derives it from that toggle instead of tracking
// an independent one here).
export function ColorThemeSelect() {
  const { theme, setTheme } = useTheme();
  const colorName = theme.replace(/-(light|dark)$/, "");
  const isDark = theme.endsWith("-dark");
  const current = sortedThemes.find((t) => t.name === colorName) ?? sortedThemes[0];

  // Radix's SelectTrigger opens the popup on ArrowUp/ArrowDown by default (see
  // OPEN_KEYS in @radix-ui/react-select) — preventDefault here runs BEFORE that
  // (composeEventHandlers calls the caller's onKeyDown first and skips its own
  // handler if the event was prevented), so arrow keys instead just step the
  // selection directly, like a native <select> closed-popup keyboard behavior.
  const step = (delta: number) => {
    const index = sortedThemes.findIndex((t) => t.name === colorName);
    const next = sortedThemes[Math.min(Math.max(index + delta, 0), sortedThemes.length - 1)];
    if (next) setTheme(next.name);
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
            <div
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: isDark ? current.primaryDark : current.primaryLight }}
            />
            <span>{current.title}</span>
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
      </SelectContent>
    </Select>
  );
}
