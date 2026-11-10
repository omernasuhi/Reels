import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings-form";
import { getDict } from "@/i18n";
import { RuleFileList } from "@/components/rule-file-list";
import { getProfile, requireUser } from "@/server/auth";
import { db } from "@/server/db";

const t = getDict();
export const metadata: Metadata = { title: t.settings.title };

export default async function SettingsPage() {
  const profile = await getProfile();
  const user = await requireUser();
  const { data: ruleFiles } = await db().from("rule_files").select("id, name, created_at").eq("user_id", user.id).order("created_at", { ascending: false });
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
      <h2 className="mt-12 text-xl font-semibold">{t.rules.title}</h2>
      <p className="mt-1 text-muted-foreground">{t.rules.help}</p>
      <RuleFileList files={ruleFiles ?? []} />
    </div>
  );
}
