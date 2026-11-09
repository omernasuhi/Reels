import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// service_role ile çalışır ve RLS'yi atlar. Yalnızca sunucu kodunda, her
// sorguda kullanıcı kimliğiyle filtreleyerek kullanın.
export function createAdminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
