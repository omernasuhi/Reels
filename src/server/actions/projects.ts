"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDict } from "@/i18n";
import { deriveTitle } from "@/lib/text";
import { contentTypeFor, putObject } from "@/lib/storage";
import { requireUser } from "@/server/auth";
import { db, getSetting } from "@/server/db";
import * as ops from "@/server/ops";
import { MAX_RULE_FILE_CHARS } from "@/server/rules";
import type { ActionResult } from "@/server/ops";

export type NewProjectState = { error?: string; topic?: string };

const t = getDict();

const ICON_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// Adım 1: proje oluşturur ve senaryo üretimini başlatır.
export async function createProject(_prev: NewProjectState, formData: FormData): Promise<NewProjectState> {
  const n = t.newProject;
  const user = await requireUser();
  const topic = String(formData.get("topic") ?? "").trim();
  if (topic.length < 10) return { error: n.errors.tooShort, topic };
  if (topic.length > 2000) return { error: n.errors.tooLong, topic };

  const limits = await getSetting("limits");
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [{ count: active }, { count: today }] = await Promise.all([
    db().from("projects").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("status", ["producing", "rendering"]),
    db().from("projects").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since),
  ]);
  if ((active ?? 0) >= limits.max_concurrent_projects) return { error: n.errors.concurrent(limits.max_concurrent_projects), topic };
  if ((today ?? 0) >= limits.max_daily_projects) return { error: n.errors.daily(limits.max_daily_projects), topic };

  const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const v = String(formData.get(name) ?? "");
    return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  };
  const options: Record<string, string> = {
    duration: pick("duration", ["short", "long"] as const, "long"),
    tone: pick("tone", ["drama", "dark_comedy", "thriller"] as const, "drama"),
    narration: pick("narration", ["second_person", "third_person"] as const, "second_person"),
  };
  const productName = String(formData.get("productName") ?? "").trim().slice(0, 60);
  if (productName) options.productName = productName;

  const icon = formData.get("productIcon");
  const hasIcon = icon instanceof File && icon.size > 0;
  if (hasIcon && (!ICON_TYPES[icon.type] || icon.size > 2 * 1024 * 1024)) return { error: n.errors.icon, topic };

  const { data, error } = await db()
    .from("projects")
    .insert({ user_id: user.id, title: deriveTitle(topic), topic, options })
    .select("id")
    .single();
  if (error || !data) return { error: n.errors.generic, topic };
  const projectId = data.id as string;

  if (hasIcon && productName) {
    const key = `projects/${projectId}/product-icon.${ICON_TYPES[icon.type]}`;
    await putObject(key, Buffer.from(await icon.arrayBuffer()), contentTypeFor(key));
    await db().from("projects").update({ options: { ...options, productIconKey: key } }).eq("id", projectId);
  }

  // Kural dosyaları: yeni yüklenenler kullanıcının kitaplığına eklenir, seçilenler projeye bağlanır.
  const ruleIds = new Set<string>();
  for (const file of formData.getAll("ruleFiles")) {
    if (!(file instanceof File) || file.size === 0) continue;
    const content = (await file.text()).replace(/\u0000/g, "").trim();
    if (!content || content.length > MAX_RULE_FILE_CHARS) continue;
    const { data: saved } = await db().from("rule_files").insert({ user_id: user.id, name: file.name.slice(0, 120), content }).select("id").single();
    if (saved) ruleIds.add(saved.id as string);
  }
  const picked = formData.getAll("ruleIds").map(String);
  if (picked.length) {
    const { data: owned } = await db().from("rule_files").select("id").eq("user_id", user.id).in("id", picked);
    for (const r of owned ?? []) ruleIds.add(r.id as string);
  }
  if (ruleIds.size) {
    await db().from("project_rules").insert([...ruleIds].slice(0, 5).map((rule_file_id) => ({ project_id: projectId, rule_file_id })));
  }

  // Kredi yetmezse proje taslak kalır; kullanıcı proje sayfasından yeniden dener.
  await ops.requestScript(user.id, projectId);
  redirect(`/projects/${projectId}`);
}

// Arayüz düğmelerinin çağırdığı eylemler: oturumdaki kullanıcıyla ops fonksiyonlarını çalıştırır.
export async function requestScript(projectId: string, instruction?: string): Promise<ActionResult> {
  return ops.requestScript((await requireUser()).id, projectId, instruction);
}

export async function approveScript(projectId: string, text: string): Promise<ActionResult> {
  return ops.approveScript((await requireUser()).id, projectId, text);
}

export async function retryFramePlan(projectId: string): Promise<ActionResult> {
  return ops.retryFramePlan((await requireUser()).id, projectId);
}

export async function approveCharacter(characterId: string): Promise<ActionResult> {
  return ops.approveCharacter((await requireUser()).id, characterId);
}

export async function regenerateCharacter(characterId: string, description?: string): Promise<ActionResult> {
  return ops.regenerateCharacter((await requireUser()).id, characterId, description);
}

export async function startProduction(projectId: string, pilot = false): Promise<ActionResult> {
  return ops.startProduction((await requireUser()).id, projectId, pilot);
}

export async function continueProduction(projectId: string): Promise<ActionResult> {
  return ops.continueProduction((await requireUser()).id, projectId);
}

export async function retryFrame(frameId: string): Promise<ActionResult> {
  return ops.retryFrame((await requireUser()).id, frameId);
}

export async function acceptFrame(frameId: string): Promise<ActionResult> {
  return ops.acceptFrame((await requireUser()).id, frameId);
}

export async function regenerateFrame(frameId: string): Promise<ActionResult> {
  return ops.regenerateFrame((await requireUser()).id, frameId);
}

export async function updateCard(cardId: string, patch: { text?: string; enabled?: boolean }): Promise<ActionResult> {
  return ops.updateCard((await requireUser()).id, cardId, patch);
}

export async function exportVideo(projectId: string): Promise<ActionResult> {
  return ops.exportVideo((await requireUser()).id, projectId);
}

export async function deleteRuleFile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await db().from("rule_files").delete().eq("id", String(formData.get("id"))).eq("user_id", user.id);
  revalidatePath("/settings");
  return { ok: true };
}
