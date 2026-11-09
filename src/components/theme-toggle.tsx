"use client";

import { Button } from "@/components/ui/button";
import { getDict } from "@/i18n";

const t = getDict();

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.classList.contains("dark") ? "light" : "dark";
    root.classList.toggle("dark", next === "dark");
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <Button type="button" variant="ghost" size="sm" onClick={toggle}>
      <span className="hidden dark:inline">{t.nav.themeToLight}</span>
      <span className="dark:hidden">{t.nav.themeToDark}</span>
    </Button>
  );
}
