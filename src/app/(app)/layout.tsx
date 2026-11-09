import { AppHeader } from "@/components/app-header";
import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";
import { getProfile, isAdmin, requireUser } from "@/server/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  if (!isSupabaseConfigured) {
    return (
      <main id="main" className="mx-auto w-full max-w-md px-5 py-16">
        <SetupNotice />
      </main>
    );
  }
  await requireUser();
  const profile = await getProfile();
  return (
    <>
      <AppHeader credits={profile?.credits_balance ?? null} admin={await isAdmin()} />
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
        {children}
      </main>
    </>
  );
}
