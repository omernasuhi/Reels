"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDict } from "@/i18n";
import { env, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string; email?: string };

const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(200),
});

// Supabase hata kodlarını kullanıcıya gösterilecek sade mesajlara çevirir.
function messageFor(code: string | undefined): string {
  const e = getDict().auth.errors;
  switch (code) {
    case "invalid_credentials":
      return e.invalidCredentials;
    case "email_not_confirmed":
      return e.emailNotConfirmed;
    case "user_already_exists":
    case "email_exists":
      return e.userExists;
    case "weak_password":
      return e.weakPassword;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return e.rateLimited;
    default:
      return e.generic;
  }
}

async function appOrigin() {
  if (env.appUrl) return env.appUrl.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function parse(formData: FormData) {
  return credentials.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const t = getDict();
  const email = String(formData.get("email") ?? "").trim();
  if (!isSupabaseConfigured) return { error: t.setup.body, email };
  const parsed = parse(formData);
  if (!parsed.success) return { error: t.auth.errors.invalidInput, email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: messageFor(error.code), email };
  redirect("/");
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const t = getDict();
  const email = String(formData.get("email") ?? "").trim();
  if (!isSupabaseConfigured) return { error: t.setup.body, email };
  const parsed = parse(formData);
  if (!parsed.success) return { error: t.auth.errors.invalidInput, email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${await appOrigin()}/auth/confirm` },
  });
  if (error) return { error: messageFor(error.code), email };
  // E-posta onayı kapalıysa oturum hemen açılır.
  if (data.session) redirect("/");
  return { message: t.auth.checkEmail };
}

export async function signOut() {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
