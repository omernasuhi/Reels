import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings-form";
import { getDict } from "@/i18n";
import { getProfile } from "@/server/auth";

const t = getDict();
export const metadata: Metadata = { title: t.settings.title };

export default async function SettingsPage() {
  const profile = await getProfile();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">{t.settings.title}</h1>
      <div className="mt-8">
        <SettingsForm
          locale={profile?.locale ?? "tr"}
          defaultVoiceId={profile?.default_voice_id ?? ""}
          notifyEmail={profile?.notify_email ?? true}
        />
      </div>
    </div>
  );
}
