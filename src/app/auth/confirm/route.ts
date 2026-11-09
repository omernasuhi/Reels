import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// E-posta onay bağlantısının döndüğü adres. Supabase'in iki bağlantı biçimini de karşılar:
// ?code=... (PKCE) ve ?token_hash=...&type=... (özel e-posta şablonu).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const target = request.nextUrl.clone();
  target.search = "";

  if (isSupabaseConfigured) {
    const supabase = await createClient();
    let ok = false;
    if (code) {
      ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
    } else if (tokenHash && type) {
      ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
    }
    if (ok) {
      target.pathname = "/";
      return NextResponse.redirect(target);
    }
  }

  target.pathname = "/login";
  target.searchParams.set("error", "link");
  return NextResponse.redirect(target);
}
