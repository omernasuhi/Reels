import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env, isSupabaseConfigured } from "@/lib/env";
import type { Profile } from "@/lib/types";

export const getUser = cache(async () => {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, credits_balance, is_admin, locale, default_voice_id, notify_email")
    .eq("id", user.id)
    .maybeSingle();
  return data as Profile | null;
});

// Yönetici: profiles.is_admin ya da ADMIN_EMAILS listesindeki e-posta.
export const isAdmin = cache(async (): Promise<boolean> => {
  const user = await getUser();
  if (!user) return false;
  if (user.email && env.adminEmails.includes(user.email.toLowerCase())) return true;
  return Boolean((await getProfile())?.is_admin);
});
