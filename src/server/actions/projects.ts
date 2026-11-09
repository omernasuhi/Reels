"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDict } from "@/i18n";
import { send } from "@/inngest/client";
import { countWords, normalizeWs } from "@/lib/pipeline/tags";
import { deriveTitle } from "@/lib/text";
import { contentTypeFor, putObject } from "@/lib/storage";
import type { Character, Frame, Project, Script } from "@/lib/types";
import { requireUser } from "@/server/auth";
import { db, getSetting, logEvent, refundCredits, reserveCredits } from "@/server/db";
import { latestScript } from "@/server/pipeline/script";

export type ActionResult = { error?: string; ok?: boolean };
export type NewProjectState = { error?: string; topic?: string };

const t = getDict();
const nonce = () => crypto.randomUUID().slice(0, 8);

async function balanceOf(userId: string) {
  const { data } = await db().from("profiles").select("credits_balance").eq("id", userId).single();
  return (data?.credits_balance as number) ?? 0;
}

// Üst çubuktaki bakiye ortak düzende durur; kredi hareketinden sonra tazelenir.
function touch() {
  revalidatePath("/", "layout");
}

async function insufficient(userId: string, need: number): Promise<ActionResult> {
  return { error: t.common.insufficientCredits(need, await balanceOf(userId)) };
}

// Projeyi sahibine göre yükler; başkasının projesi "yok" sayılır.
async function ownProject(projectId: string, userId: string): Promise<Project | null> {
  const { data } = await db().from("projects").select("*").eq("id", projectId).eq("user_id", userId).maybeSingle();
  return data as Project | null;
}

// Durum geçişini koşullu yapar: iki kez basılan düğmede yalnızca biri kazanır.
async function transition(projectId: string, from: string[], patch: Record<string, unknown>) {
  const { data } = await db().from("projects").update(patch).eq("id", projectId).in("status", from).select("id");
  return Boolean(data?.length);
}

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

  // Kredi yetmezse proje taslak kalır; kullanıcı proje sayfasından yeniden dener.
  await requestScript(projectId);
  redirect(`/projects/${projectId}`);
}

// Senaryo üretimi ya da hazır düğmeyle yeniden yazım.
export async function requestScript(projectId: string, instruction?: string): Promise<ActionResult> {
  const user = await requireUser();
  const project = await ownProject(projectId, user.id);
  if (!project || !["draft", "script"].includes(project.status) || project.job_step) return { error: t.common.notAllowed };
  if (instruction && instruction.length > 500) return { error: t.common.actionFailed };

  const pricing = await getSetting("pricing");
  const chargeRef = `script:${projectId}:${nonce()}`;
  if (!(await reserveCredits(user.id, projectId, pricing.script, "script", chargeRef))) {
    await db().from("projects").update({ job_error: t.common.insufficientCredits(pricing.script, await balanceOf(user.id)) }).eq("id", projectId);
    return insufficient(user.id, pricing.script);
  }
  await db().from("projects").update({ job_step: "script", job_error: null, job_started_at: new Date().toISOString() }).eq("id", projectId);
  try {
    await send("project/script.requested", { projectId, userId: user.id, chargeRef, instruction });
  } catch (err) {
    await refundCredits(user.id, chargeRef);
    await db().from("projects").update({ job_step: null, job_error: t.common.actionFailed }).eq("id", projectId);
    await logEvent(projectId, "queue", "Olay gönderilemedi", { error: String(err) }, "error");
    return { error: t.common.actionFailed };
  }
  touch();
  return { ok: true };
}

// Adım 2 onayı: metin düzenlendiyse yeni sürüm kaydeder, karakter kartlarını ve kare planını başlatır.
export async function approveScript(projectId: string, text: string): Promise<ActionResult> {
  const user = await requireUser();
  const project = await ownProject(projectId, user.id);
  const script = await latestScript(projectId);
  if (!project || project.status !== "script" || project.job_step || !script) return { error: t.common.notAllowed };
  const plain = text.replace(/\r\n/g, "\n").trim();
  if (!plain) return { error: t.script.empty };
  if (plain.length > 6000) return { error: t.common.actionFailed };

  const { data: chars } = await db().from("characters").select("*").eq("project_id", projectId).order("created_at");
  const characters = (chars ?? []) as Character[];
  const pricing = await getSetting("pricing");
  const total = characters.length * pricing.character_card;
  if ((await balanceOf(user.id)) < total) return insufficient(user.id, total);

  if (!(await transition(projectId, ["script"], { status: "characters", job_step: "prepare", job_error: null, job_started_at: new Date().toISOString() }))) {
    return { error: t.common.notAllowed };
  }

  let scriptId = script.id;
  if (normalizeWs(plain) !== normalizeWs(script.plain_text)) {
    // Elle düzenlenen metin: etiketler arka planda yeniden üretilir.
    const { data } = await db().from("scripts").insert({
      project_id: projectId,
      plain_text: plain,
      tagged_text: "",
      word_count: countWords(plain),
      version: script.version + 1,
      vote_options: script.vote_options,
      opening_stamp: script.opening_stamp,
    }).select("id").single();
    scriptId = data!.id;
  }
  await db().from("scripts").update({ approved_at: new Date().toISOString() }).eq("id", scriptId);
  await db().from("frames").delete().eq("project_id", projectId);

  const events = [];
  for (const c of characters) {
    const chargeRef = `card:${c.id}:${nonce()}`;
    if (await reserveCredits(user.id, projectId, pricing.character_card, "character_card", chargeRef)) {
      events.push({ characterId: c.id, projectId, userId: user.id, chargeRef });
    }
  }
  await db().from("characters").update({ status: "generating" }).in("id", events.map((e) => e.characterId));
  await send("project/script.approved", { projectId, userId: user.id });
  if (events.length) await send("character/generate.requested", events);
  touch();
  return { ok: true };
}

export async function retryFramePlan(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  const project = await ownProject(projectId, user.id);
  if (!project || project.status !== "characters" || project.job_step) return { error: t.common.notAllowed };
  await db().from("projects").update({ job_step: "prepare", job_error: null, job_started_at: new Date().toISOString() }).eq("id", projectId);
  await send("project/script.approved", { projectId, userId: user.id });
  return { ok: true };
}

async function ownCharacter(characterId: string, userId: string) {
  const { data } = await db().from("characters").select("*").eq("id", characterId).maybeSingle();
  const character = data as Character | null;
  if (!character) return null;
  const project = await ownProject(character.project_id, userId);
  return project ? { character, project } : null;
}

export async function approveCharacter(characterId: string): Promise<ActionResult> {
  const user = await requireUser();
  const own = await ownCharacter(characterId, user.id);
  if (!own || own.project.status !== "characters" || own.character.status !== "ready") return { error: t.common.notAllowed };
  await db().from("characters").update({ approved_at: new Date().toISOString() }).eq("id", characterId);
  return { ok: true };
}

// Kartı yeniden üretir; tarif değiştiyse kare planındaki eski tarif de güncellenir.
export async function regenerateCharacter(characterId: string, description?: string): Promise<ActionResult> {
  const user = await requireUser();
  const own = await ownCharacter(characterId, user.id);
  if (!own || own.project.status !== "characters" || own.character.status === "generating") return { error: t.common.notAllowed };
  const { character, project } = own;
  const next = description?.replace(/\s+/g, " ").trim();
  if (next !== undefined && (next.length < 20 || next.length > 800)) return { error: t.common.actionFailed };

  const pricing = await getSetting("pricing");
  const chargeRef = `card:${characterId}:${nonce()}`;
  if (!(await reserveCredits(user.id, project.id, pricing.character_card, "character_card", chargeRef))) {
    return insufficient(user.id, pricing.character_card);
  }

  if (next && next !== character.description_en) {
    const { data: frames } = await db().from("frames").select("id, shot_prompt_en").eq("project_id", project.id);
    await Promise.all(
      ((frames ?? []) as Pick<Frame, "id" | "shot_prompt_en">[])
        .filter((f) => f.shot_prompt_en.includes(character.description_en))
        .map((f) =>
          db().from("frames").update({ shot_prompt_en: f.shot_prompt_en.split(character.description_en).join(next) }).eq("id", f.id),
        ),
    );
  }
  await db().from("characters").update({ description_en: next ?? character.description_en, status: "generating", approved_at: null }).eq("id", characterId);
  await send("character/generate.requested", { characterId, projectId: project.id, userId: user.id, chargeRef });
  touch();
  return { ok: true };
}

// Adım 3 onayı: en pahalı adım. Tüm kartlar onaylı ve kare planı hazır olmalı.
export async function startProduction(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  const project = await ownProject(projectId, user.id);
  if (!project || project.status !== "characters" || project.job_step) return { error: t.common.notAllowed };

  const [{ data: chars }, { count: frameCount }] = await Promise.all([
    db().from("characters").select("status, approved_at").eq("project_id", projectId),
    db().from("frames").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);
  if (!frameCount || !(chars ?? []).every((c) => c.status === "ready" && c.approved_at)) return { error: t.characters.needApproval };

  const limits = await getSetting("limits");
  const { count: active } = await db().from("projects").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("status", ["producing", "rendering"]);
  if ((active ?? 0) >= limits.max_concurrent_projects) return { error: t.newProject.errors.concurrent(limits.max_concurrent_projects) };

  const pricing = await getSetting("pricing");
  const total = frameCount * pricing.frame + pricing.voiceover;
  if (!(await transition(projectId, ["characters"], { status: "producing", job_step: "audio", job_error: null, job_started_at: new Date().toISOString() }))) {
    return { error: t.common.notAllowed };
  }
  const chargeRef = `production:${projectId}:${nonce()}`;
  if (!(await reserveCredits(user.id, projectId, total, "production", chargeRef))) {
    await db().from("projects").update({ status: "characters", job_step: null }).eq("id", projectId);
    return insufficient(user.id, total);
  }
  await send("project/production.requested", { projectId, userId: user.id, chargeRef });
  touch();
  return { ok: true };
}

async function ownFrame(frameId: string, userId: string) {
  const { data } = await db().from("frames").select("*").eq("id", frameId).maybeSingle();
  const frame = data as Frame | null;
  if (!frame) return null;
  const project = await ownProject(frame.project_id, userId);
  return project ? { frame, project } : null;
}

// Başarısız ya da gözden geçirme bekleyen kareyi yeniden dener; kredi düşmez.
export async function retryFrame(frameId: string): Promise<ActionResult> {
  const user = await requireUser();
  const own = await ownFrame(frameId, user.id);
  if (!own || !["error", "review"].includes(own.frame.status)) return { error: t.common.notAllowed };
  const { data } = await db().from("frames").update({ status: "queued" }).eq("id", frameId).in("status", ["error", "review"]).select("id");
  if (!data?.length) return { error: t.common.notAllowed };
  await send("frame/generate.requested", { frameId, projectId: own.project.id, userId: user.id, mode: "retry" });
  return { ok: true };
}

export async function acceptFrame(frameId: string): Promise<ActionResult> {
  const user = await requireUser();
  const own = await ownFrame(frameId, user.id);
  if (!own || own.frame.status !== "review") return { error: t.common.notAllowed };
  await db().from("frames").update({ status: "ready" }).eq("id", frameId);
  return { ok: true };
}

// Kullanıcı isteğiyle kare yenileme (kredi düşer; başarısız olursa iade edilir).
export async function regenerateFrame(frameId: string): Promise<ActionResult> {
  const user = await requireUser();
  const own = await ownFrame(frameId, user.id);
  if (!own || !["preview", "done"].includes(own.project.status) || !["ready", "review"].includes(own.frame.status)) {
    return { error: t.common.notAllowed };
  }
  const pricing = await getSetting("pricing");
  const chargeRef = `regen:${frameId}:${nonce()}`;
  if (!(await reserveCredits(user.id, own.project.id, pricing.frame_regenerate, "frame_regenerate", chargeRef))) {
    return insufficient(user.id, pricing.frame_regenerate);
  }
  await db().from("frames").update({ status: "queued" }).eq("id", frameId);
  await send("frame/generate.requested", { frameId, projectId: own.project.id, userId: user.id, mode: "regen", chargeRef });
  touch();
  return { ok: true };
}

export async function updateCard(cardId: string, patch: { text?: string; enabled?: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  const { data: card } = await db().from("cards").select("id, project_id").eq("id", cardId).maybeSingle();
  if (!card || !(await ownProject(card.project_id, user.id))) return { error: t.common.notAllowed };
  const update: Record<string, unknown> = {};
  if (typeof patch.text === "string") {
    const text = patch.text.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!text) return { error: t.common.actionFailed };
    update.text = text;
  }
  if (typeof patch.enabled === "boolean") update.enabled = patch.enabled;
  await db().from("cards").update(update).eq("id", cardId);
  return { ok: true };
}

// Adım 5: iki varyantı render eder.
export async function exportVideo(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  const project = await ownProject(projectId, user.id);
  if (!project || !["preview", "done"].includes(project.status)) return { error: t.common.notAllowed };
  const { data: busy } = await db().from("frames").select("id").eq("project_id", projectId).not("status", "in", "(ready,review)").limit(1);
  if (busy?.length) return { error: t.common.notAllowed };

  const pricing = await getSetting("pricing");
  if (!(await transition(projectId, ["preview", "done"], { status: "rendering", job_step: "render_cards", job_error: null, job_started_at: new Date().toISOString() }))) {
    return { error: t.common.notAllowed };
  }
  const chargeRef = `render:${projectId}:${nonce()}`;
  if (!(await reserveCredits(user.id, projectId, pricing.render, "render", chargeRef))) {
    await db().from("projects").update({ status: project.status, job_step: null }).eq("id", projectId);
    return insufficient(user.id, pricing.render);
  }
  await db().from("renders").delete().eq("project_id", projectId);
  await send("project/render.requested", { projectId, userId: user.id, chargeRef });
  touch();
  return { ok: true };
}

export type { Script };
