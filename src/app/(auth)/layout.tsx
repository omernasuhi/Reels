import { SetupNotice } from "@/components/setup-notice";
import { ThemeToggle } from "@/components/theme-toggle";
import { getDict } from "@/i18n";
import { isSupabaseConfigured } from "@/lib/env";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  const t = getDict();
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold">{t.app.name}</span>
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 flex-col justify-center py-10">
        {isSupabaseConfigured ? null : (
          <div className="mb-8">
            <SetupNotice />
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
