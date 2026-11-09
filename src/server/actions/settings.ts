"use server";

import { revalidatePath } from "next/cache";
import { getDict, locales, type Locale } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";

export type SettingsState = { ok?: boolean; error?: string };

export async function saveSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const t = getDict().settings;
  const user = await requireUser();

  const locale = String(formData.get("locale") ?? "tr");
  const voice = String(formData.get("default_voice_id") ?? "").trim();
  if (!locales.includes(locale as Locale) || voice.length > 100 || /[^\w-]/.test(voice)) {
    return { error: t.error };
  }

  // Kullanıcının kendi oturumuyla yazılır: RLS ve sütun yetkileri yalnızca
  // bu üç ayar sütununa izin verir.
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      locale,
      default_voice_id: voice || null,
      notify_email: formData.get("notify_email") === "on",
    })
    .eq("id", user.id);

  if (error) return { error: t.error };
  revalidatePath("/settings");
  return { ok: true };
}
