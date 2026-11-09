import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getDict } from "@/i18n";
import { signOut } from "@/server/actions/auth";

export function AppHeader({ credits, admin }: { credits: number | null; admin: boolean }) {
  const t = getDict();
  const links = [
    { href: "/", label: t.nav.dashboard },
    { href: "/credits", label: t.nav.credits },
    { href: "/settings", label: t.nav.settings },
    ...(admin ? [{ href: "/admin", label: t.nav.admin }] : []),
  ];
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
        <Link href="/" className="text-lg font-semibold">
          {t.app.name}
        </Link>
        <div className="ml-auto flex items-center sm:order-last sm:ml-0">
          <ThemeToggle />
          {credits === null ? null : (
            <Link
              href="/credits"
              className="rounded-md px-2 py-1 text-base font-medium hover:bg-muted"
            >
              {t.nav.creditsBalance(credits)}
            </Link>
          )}
        </div>
        <nav
          aria-label={t.nav.main}
          className="-mx-3 flex w-full flex-wrap items-center sm:mx-0 sm:ml-auto sm:w-auto"
        >
          {links.map((l) => (
            <Button key={l.href} asChild variant="ghost" size="sm">
              <Link href={l.href}>{l.label}</Link>
            </Button>
          ))}
          <form action={signOut} className="ml-auto sm:ml-0">
            <Button type="submit" variant="ghost" size="sm">
              {t.nav.signOut}
            </Button>
          </form>
        </nav>
      </div>
    </header>
  );
}
