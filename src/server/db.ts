import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Sunucu tarafı veritabanı erişimi (service_role). İstek başına yeni istemci ucuzdur.
export function db() {
  return createAdminClient();
}

export type Pricing = {
  script: number;
  character_card: number;
  frame: number;
  voiceover: number;
  render: number;
  frame_regenerate: number;
};
export type Limits = { max_concurrent_projects: number; max_daily_projects: number };
export type ApiPrices = {
  claude_input_per_mtok: number;
  claude_output_per_mtok: number;
  replicate_image: number;
  elevenlabs_per_1k_chars: number;
  scribe_per_minute: number;
  render: number;
  credit_value: number;
};

const DEFAULTS = {
  pricing: { script: 2, character_card: 3, frame: 3, voiceover: 30, render: 5, frame_regenerate: 3 },
  limits: { max_concurrent_projects: 2, max_daily_projects: 10 },
  api_prices: {
    claude_input_per_mtok: 2,
    claude_output_per_mtok: 10,
    replicate_image: 0.04,
    elevenlabs_per_1k_chars: 0.15,
    scribe_per_minute: 0.007,
    render: 0.02,
    credit_value: 0.05,
  },
};

export async function getSetting<K extends keyof typeof DEFAULTS>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const { data } = await db().from("app_settings").select("value").eq("key", key).maybeSingle();
  return { ...DEFAULTS[key], ...((data?.value as object) ?? {}) };
}

// Yapılandırılmış log + proje olay günlüğü (yöneticiye görünür).
export async function logEvent(
  projectId: string,
  step: string,
  message: string,
  data?: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info",
) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, projectId, step, message, ...data }));
  await db().from("project_events").insert({ project_id: projectId, step, message, data, level });
}

export async function logCost(
  projectId: string | null,
  userId: string | null,
  provider: string,
  operation: string,
  costUsd: number,
  meta?: Record<string, unknown>,
) {
  await db().from("api_costs").insert({
    project_id: projectId,
    user_id: userId,
    provider,
    operation,
    cost_usd: Math.round(costUsd * 1e6) / 1e6,
    meta,
  });
}

// Kredi: rezerve işlem başlamadan düşer, başarısızlıkta aynı ref ile iade edilir.
export async function reserveCredits(
  userId: string,
  projectId: string | null,
  amount: number,
  reason: string,
  ref: string,
): Promise<boolean> {
  const { data, error } = await db().rpc("reserve_credits", {
    p_user: userId,
    p_project: projectId,
    p_amount: amount,
    p_reason: reason,
    p_ref: ref,
  });
  if (error) throw new Error(`reserve_credits: ${error.message}`);
  return data === true;
}

export async function refundCredits(userId: string, ref: string): Promise<number> {
  const { data, error } = await db().rpc("refund_credits", { p_user: userId, p_ref: ref });
  if (error) throw new Error(`refund_credits: ${error.message}`);
  return (data as number) ?? 0;
}
