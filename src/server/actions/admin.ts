"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { getDict } from "@/i18n";
import { isAdmin } from "@/server/auth";
import { db } from "@/server/db";

export type GrantState = { ok?: boolean; error?: string };

// Ödeme sağlayıcısı bağlanana kadar krediler yönetici tarafından yüklenir.
export async function grantCreditsAction(_prev: GrantState, formData: FormData): Promise<GrantState> {
  const t = getDict().admin;
  if (!(await isAdmin())) return { error: t.grantError };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const amount = Math.floor(Number(formData.get("amount")));
  if (!email || !(amount > 0) || amount > 100000) return { error: t.grantError };

  const { data, error } = await db().auth.admin.listUsers({ perPage: 1000 });
  const user = data?.users.find((u) => u.email?.toLowerCase() === email);
  if (error || !user) return { error: t.grantError };

  const { error: rpcError } = await db().rpc("grant_credits", {
    p_user: user.id,
    p_amount: amount,
    p_kind: "adjust",
    p_reason: "admin_grant",
    p_ref: `admin:${crypto.randomUUID()}`,
  });
  if (rpcError) return { error: t.grantError };
  revalidatePath("/admin");
  return { ok: true };
}
