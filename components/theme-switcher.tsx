import { Check, Moon, Palette, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sortedThemes, themes } from "@/lib/themes-config";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

// Helper to get current color theme and mode from theme string like "catppuccin-dark"
function parseTheme(theme: string | undefined): {
  colorTheme: string;
  mode: "light" | "dark";
} {
  if (!theme) return { colorTheme: "default", mode: "dark" };

  if (theme.endsWith("-dark")) {
    return { colorTheme: theme.replace("-dark", ""), mode: "dark" };
  }
  if (theme.endsWith("-light")) {
    return { colorTheme: theme.replace("-light", ""), mode: "light" };
  }
  return { colorTheme: "default", mode: "dark" };
}

export function ThemeSwitcher() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const { colorTheme, mode } = parseTheme(theme);

  const setColorTheme = (name: string) => {
    setTheme(`${name}-${mode}`);
  };

  const setMode = (newMode: "light" | "dark") => {
    setTheme(`${colorTheme}-${newMode}`);
  };

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const currentThemeConfig =
    themes.find((t) => t.name === colorTheme) || themes[0];
  const isDark = mode === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9">
          {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="flex items-center gap-2">
          <div
            className="h-3 w-3 rounded-full"
            style={{
              backgroundColor: isDark
                ? currentThemeConfig.primaryDark
                : currentThemeConfig.primaryLight,
            }}
          />
          {currentThemeConfig.title}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Mode Toggle */}
        <DropdownMenuItem
          onClick={() => setMode("light")}
          className={cn("flex items-center gap-2 cursor-pointer")}
        >
          <Sun className="h-4 w-4" />
          <span className="flex-1">Light</span>
          {mode === "light" && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setMode("dark")}
          className={cn("flex items-center gap-2 cursor-pointer")}
        >
          <Moon className="h-4 w-4" />
          <span className="flex-1">Dark</span>
          {mode === "dark" && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Color Theme Submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            <span>Color Theme</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-52">
              <ScrollArea className="h-80">
                <div className="p-1">
                  {sortedThemes.map((t) => (
                    <DropdownMenuItem
                      key={t.name}
                      onClick={() => setColorTheme(t.name)}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <div
                        className="h-4 w-4 rounded-full border border-border shrink-0"
                        style={{
                          backgroundColor: isDark
                            ? t.primaryDark
                            : t.primaryLight,
                        }}
                      />
                      <span className="flex-1">{t.title}</span>
                      {colorTheme === t.name && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </div>
              </ScrollArea>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
