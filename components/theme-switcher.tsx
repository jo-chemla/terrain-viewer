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

  return (
    <Select value={colorName} onValueChange={setTheme}>
      <SelectTrigger className="w-full cursor-pointer">
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
