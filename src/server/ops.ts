import "server-only";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { getDict } from "@/i18n";
import { send } from "@/inngest/client";
import { countWords, normalizeWs } from "@/lib/pipeline/tags";
import type { Character, Frame, Project } from "@/lib/types";
import { db, getSetting, logEvent, refundCredits, reserveCredits } from "@/server/db";
import { latestScript } from "@/server/pipeline/script";

// Proje işlemleri. Hem arayüz düğmeleri (sunucu eylemleri) hem de proje
// asistanının araçları bu fonksiyonları çağırır; hepsi sahipliği userId ile denetler.

export type ActionResult = { error?: string; ok?: boolean };

const t = getDict();
const nonce = () => crypto.randomUUID().slice(0, 8);

export async function balanceOf(userId: string) {
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
export async function ownProject(projectId: string, userId: string): Promise<Project | null> {
  const { data } = await db().from("projects").select("*").eq("id", projectId).eq("user_id", userId).maybeSingle();
  return data as Project | null;
}

// Durum geçişini koşullu yapar: iki kez basılan düğmede yalnızca biri kazanır.
async function transition(projectId: string, from: string[], patch: Record<string, unknown>) {
  const { data } = await db().from("projects").update(patch).eq("id", projectId).in("status", from).select("id");
  return Boolean(data?.length);
}

// Senaryo üretimi ya da hazır düğmeyle yeniden yazım.
export async function requestScript(userId: string, projectId: string, instruction?: string): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  if (!project || !["draft", "script"].includes(project.status) || project.job_step) return { error: t.common.notAllowed };
  if (instruction && instruction.length > 500) return { error: t.common.actionFailed };

  const pricing = await getSetting("pricing");
  const chargeRef = `script:${projectId}:${nonce()}`;
  if (!(await reserveCredits(userId, projectId, pricing.script, "script", chargeRef))) {
    await db().from("projects").update({ job_error: t.common.insufficientCredits(pricing.script, await balanceOf(userId)) }).eq("id", projectId);
    return insufficient(userId, pricing.script);
  }
  await db().from("projects").update({ job_step: "script", job_error: null, job_started_at: new Date().toISOString() }).eq("id", projectId);
  try {
    await send("project/script.requested", { projectId, userId: userId, chargeRef, instruction });
  } catch (err) {
    await refundCredits(userId, chargeRef);
    await db().from("projects").update({ job_step: null, job_error: t.common.actionFailed }).eq("id", projectId);
    await logEvent(projectId, "queue", "Olay gönderilemedi", { error: String(err) }, "error");
    return { error: t.common.actionFailed };
  }
  touch();
  return { ok: true };
}

// Adım 2 onayı: metin düzenlendiyse yeni sürüm kaydeder, karakter kartlarını ve kare planını başlatır.
export async function approveScript(userId: string, projectId: string, text: string): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  const script = await latestScript(projectId);
  if (!project || project.status !== "script" || project.job_step || !script) return { error: t.common.notAllowed };
  const plain = text.replace(/\r\n/g, "\n").trim();
  if (!plain) return { error: t.script.empty };
  if (plain.length > 6000) return { error: t.common.actionFailed };

  const { data: chars } = await db().from("characters").select("*").eq("project_id", projectId).order("created_at");
  const characters = (chars ?? []) as Character[];
  const pricing = await getSetting("pricing");
  const total = characters.length * pricing.character_card;
  if ((await balanceOf(userId)) < total) return insufficient(userId, total);

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
    if (await reserveCredits(userId, projectId, pricing.character_card, "character_card", chargeRef)) {
      events.push({ characterId: c.id, projectId, userId: userId, chargeRef });
    }
  }
  await db().from("characters").update({ status: "generating" }).in("id", events.map((e) => e.characterId));
  await send("project/script.approved", { projectId, userId: userId });
  if (events.length) await send("character/generate.requested", events);
  touch();
  return { ok: true };
}

export async function retryFramePlan(userId: string, projectId: string): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  if (!project || project.status !== "characters" || project.job_step) return { error: t.common.notAllowed };
  await db().from("projects").update({ job_step: "prepare", job_error: null, job_started_at: new Date().toISOString() }).eq("id", projectId);
  await send("project/script.approved", { projectId, userId: userId });
  return { ok: true };
}

async function ownCharacter(characterId: string, userId: string) {
  const { data } = await db().from("characters").select("*").eq("id", characterId).maybeSingle();
  const character = data as Character | null;
  if (!character) return null;
  const project = await ownProject(character.project_id, userId);
  return project ? { character, project } : null;
}

export async function approveCharacter(userId: string, characterId: string): Promise<ActionResult> {
  const own = await ownCharacter(characterId, userId);
  if (!own || own.project.status !== "characters" || own.character.status !== "ready") return { error: t.common.notAllowed };
  await db().from("characters").update({ approved_at: new Date().toISOString() }).eq("id", characterId);
  return { ok: true };
}

// Kartı yeniden üretir; tarif değiştiyse kare planındaki eski tarif de güncellenir.
// fix verilirse mevcut kart referans alınarak yalnızca o değişiklik uygulanır.
export async function regenerateCharacter(
  userId: string,
  characterId: string,
  description?: string,
  fix?: string,
): Promise<ActionResult> {
  const own = await ownCharacter(characterId, userId);
  if (!own || own.project.status !== "characters" || own.character.status === "generating") return { error: t.common.notAllowed };
  const { character, project } = own;
  const next = description?.replace(/\s+/g, " ").trim();
  if (next !== undefined && (next.length < 20 || next.length > 800)) return { error: t.common.actionFailed };

  const pricing = await getSetting("pricing");
  const chargeRef = `card:${characterId}:${nonce()}`;
  if (!(await reserveCredits(userId, project.id, pricing.character_card, "character_card", chargeRef))) {
    return insufficient(userId, pricing.character_card);
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
  await send("character/generate.requested", { characterId, projectId: project.id, userId: userId, chargeRef, fix: fix?.slice(0, 400) });
  touch();
  return { ok: true };
}

export const PILOT_FRAMES = 4; // src/inngest/functions.ts ile aynı olmalı

// Adım 3 onayı: en pahalı adım. Tüm kartlar onaylı ve kare planı hazır olmalı.
// pilot: önce ilk 4 kare üretilir; stil onaylanınca continueProduction ile kalanı.
export async function startProduction(userId: string, projectId: string, pilot = false): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  if (!project || project.status !== "characters" || project.job_step) return { error: t.common.notAllowed };

  const [{ data: chars }, { count: frameCount }] = await Promise.all([
    db().from("characters").select("status, approved_at").eq("project_id", projectId),
    db().from("frames").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);
  if (!frameCount || !(chars ?? []).every((c) => c.status === "ready" && c.approved_at)) return { error: t.characters.needApproval };

  const limits = await getSetting("limits");
  const { count: active } = await db().from("projects").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["producing", "rendering"]);
  if ((active ?? 0) >= limits.max_concurrent_projects) return { error: t.newProject.errors.concurrent(limits.max_concurrent_projects) };

  const pricing = await getSetting("pricing");
  const usePilot = pilot && frameCount > PILOT_FRAMES;
  const total = usePilot ? PILOT_FRAMES * pricing.frame : frameCount * pricing.frame + pricing.voiceover;
  if (!(await transition(projectId, ["characters"], { status: "producing", job_step: usePilot ? "pilot" : "audio", job_error: null, job_started_at: new Date().toISOString() }))) {
    return { error: t.common.notAllowed };
  }
  const chargeRef = `production:${projectId}:${nonce()}`;
  if (!(await reserveCredits(userId, projectId, total, "production", chargeRef))) {
    await db().from("projects").update({ status: "characters", job_step: null }).eq("id", projectId);
    return insufficient(userId, total);
  }
  await send("project/production.requested", { projectId, userId: userId, chargeRef, pilot: usePilot });
  touch();
  return { ok: true };
}

// Pilot kareler onaylandıktan sonra kalan kareleri ve seslendirmeyi üretir.
export async function continueProduction(userId: string, projectId: string): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  if (!project || project.status !== "producing" || project.job_step !== "pilot_review") return { error: t.common.notAllowed };
  const { count: remaining } = await db().from("frames").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "queued");
  const pricing = await getSetting("pricing");
  const total = (remaining ?? 0) * pricing.frame + pricing.voiceover;
  const { data: won } = await db().from("projects").update({ job_step: "audio", job_error: null, job_started_at: new Date().toISOString() }).eq("id", projectId).eq("job_step", "pilot_review").select("id");
  if (!won?.length) return { error: t.common.notAllowed };
  const chargeRef = `production:${projectId}:${nonce()}`;
  if (!(await reserveCredits(userId, projectId, total, "production", chargeRef))) {
    await db().from("projects").update({ job_step: "pilot_review" }).eq("id", projectId);
    return insufficient(userId, total);
  }
  await send("project/production.requested", { projectId, userId: userId, chargeRef, pilot: false, resume: true });
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
export async function retryFrame(userId: string, frameId: string): Promise<ActionResult> {
  const own = await ownFrame(frameId, userId);
  if (!own || !["error", "review"].includes(own.frame.status)) return { error: t.common.notAllowed };
  const { data } = await db().from("frames").update({ status: "queued" }).eq("id", frameId).in("status", ["error", "review"]).select("id");
  if (!data?.length) return { error: t.common.notAllowed };
  await send("frame/generate.requested", { frameId, projectId: own.project.id, userId: userId, mode: "retry" });
  return { ok: true };
}

export async function acceptFrame(userId: string, frameId: string): Promise<ActionResult> {
  const own = await ownFrame(frameId, userId);
  if (!own || own.frame.status !== "review") return { error: t.common.notAllowed };
  await db().from("frames").update({ status: "ready" }).eq("id", frameId);
  return { ok: true };
}

// Kullanıcı isteğiyle kare yenileme (kredi düşer; başarısız olursa iade edilir).
// fix verilirse mevcut kare referans alınarak yalnızca o değişiklik uygulanır.
export async function regenerateFrame(userId: string, frameId: string, fix?: string): Promise<ActionResult> {
  const own = await ownFrame(frameId, userId);
  const reviewable = own && (["preview", "done"].includes(own.project.status) || own.project.job_step === "pilot_review");
  if (!own || !reviewable || !["ready", "review"].includes(own.frame.status)) return { error: t.common.notAllowed };
  const pricing = await getSetting("pricing");
  const chargeRef = `regen:${frameId}:${nonce()}`;
  if (!(await reserveCredits(userId, own.project.id, pricing.frame_regenerate, "frame_regenerate", chargeRef))) {
    return insufficient(userId, pricing.frame_regenerate);
  }
  await db().from("frames").update({ status: "generating" }).eq("id", frameId);
  await send("frame/generate.requested", { frameId, projectId: own.project.id, userId: userId, mode: "regen", chargeRef, fix: fix?.slice(0, 400) });
  touch();
  return { ok: true };
}

// Sahne tarifini (shot prompt) değiştirir; görsel ayrıca yeniden üretilir.
// characterIds verilirse karedeki karakter listesi (referans kartları) da güncellenir.
export async function setFramePrompt(userId: string, frameId: string, shot: string, characterIds?: string[]): Promise<ActionResult> {
  const own = await ownFrame(frameId, userId);
  const text = shot.replace(/\s+/g, " ").trim();
  if (!own || text.length < 20 || text.length > 2500) return { error: t.common.actionFailed };
  if (["rendering"].includes(own.project.status)) return { error: t.common.notAllowed };
  await db().from("frames").update({ shot_prompt_en: text, ...(characterIds ? { character_ids: characterIds.slice(0, 3) } : {}) }).eq("id", frameId);
  return { ok: true };
}

// Mekân tarifini değiştirir (o mekândaki sonraki tüm üretimlerde kullanılır).
export async function setLocation(userId: string, projectId: string, key: string, description: string): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  const text = description.replace(/\s+/g, " ").trim();
  if (!project || text.length < 10 || text.length > 600) return { error: t.common.actionFailed };
  const { data } = await db().from("locations").update({ description_en: text }).eq("project_id", projectId).eq("key", key).select("id");
  return data?.length ? { ok: true } : { error: t.common.actionFailed };
}

export async function addCard(
  userId: string,
  projectId: string,
  card: { text: string; frame_index: number; offset?: number; duration?: number; size?: number; y_position?: number },
): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  const text = card.text.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!project || !text) return { error: t.common.actionFailed };
  const clamp = (v: number | undefined, min: number, max: number, d: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? (v as number) : d));
  const { error } = await db().from("cards").insert({
    project_id: projectId,
    text,
    frame_index: Math.max(0, Math.floor(card.frame_index)),
    offset: clamp(card.offset, 0, 20, 0),
    duration: clamp(card.duration, 0.5, 15, 1.8),
    size: clamp(card.size, 40, 160, 96),
    y_position: clamp(card.y_position, 0.05, 0.95, 0.5),
  });
  return error ? { error: t.common.actionFailed } : { ok: true };
}

export async function removeCard(userId: string, cardId: string): Promise<ActionResult> {
  const { data: card } = await db().from("cards").select("id, project_id").eq("id", cardId).maybeSingle();
  if (!card || !(await ownProject(card.project_id, userId))) return { error: t.common.notAllowed };
  await db().from("cards").delete().eq("id", cardId);
  return { ok: true };
}

// Seslendirmeyi baştan üretir ve zaman çizelgesini yeniden kurar (kareler korunur).
export async function regenerateAudio(userId: string, projectId: string): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  if (!project || !["preview", "done"].includes(project.status)) return { error: t.common.notAllowed };
  const pricing = await getSetting("pricing");
  if (!(await transition(projectId, ["preview", "done"], { status: "producing", job_step: "audio", job_error: null, job_started_at: new Date().toISOString() }))) {
    return { error: t.common.notAllowed };
  }
  const chargeRef = `audio:${projectId}:${nonce()}`;
  if (!(await reserveCredits(userId, projectId, pricing.voiceover, "voiceover", chargeRef))) {
    await db().from("projects").update({ status: project.status, job_step: null }).eq("id", projectId);
    return insufficient(userId, pricing.voiceover);
  }
  await send("project/production.requested", { projectId, userId: userId, chargeRef, freshAudio: true });
  touch();
  return { ok: true };
}

// Senaryo metnini onaylamadan kaydeder (asistanın küçük düzeltmeleri için).
export async function setScriptText(userId: string, projectId: string, text: string, voteOptions?: string[]): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  const script = await latestScript(projectId);
  const plain = text.replace(/\r\n/g, "\n").trim();
  if (!project || project.status !== "script" || project.job_step || !script) return { error: t.common.notAllowed };
  if (!plain || plain.length > 6000) return { error: t.script.empty };
  const votes = voteOptions?.length === 2 ? voteOptions.map((v) => v.trim().slice(0, 30)) : script.vote_options;
  if (normalizeWs(plain) === normalizeWs(script.plain_text)) {
    await db().from("scripts").update({ vote_options: votes }).eq("id", script.id);
    return { ok: true };
  }
  const { error } = await db().from("scripts").insert({
    project_id: projectId,
    plain_text: plain,
    tagged_text: "",
    word_count: countWords(plain),
    version: script.version + 1,
    vote_options: votes,
    opening_stamp: script.opening_stamp,
  });
  return error ? { error: t.common.actionFailed } : { ok: true };
}

export async function updateCard(userId: string, cardId: string, patch: { text?: string; enabled?: boolean }): Promise<ActionResult> {
  const { data: card } = await db().from("cards").select("id, project_id").eq("id", cardId).maybeSingle();
  if (!card || !(await ownProject(card.project_id, userId))) return { error: t.common.notAllowed };
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
export async function exportVideo(userId: string, projectId: string): Promise<ActionResult> {
  const project = await ownProject(projectId, userId);
  if (!project || !["preview", "done"].includes(project.status)) return { error: t.common.notAllowed };
  const { data: busy } = await db().from("frames").select("id").eq("project_id", projectId).not("status", "in", "(ready,review)").limit(1);
  if (busy?.length) return { error: t.common.notAllowed };

  const pricing = await getSetting("pricing");
  if (!(await transition(projectId, ["preview", "done"], { status: "rendering", job_step: "render_cards", job_error: null, job_started_at: new Date().toISOString() }))) {
    return { error: t.common.notAllowed };
  }
  const chargeRef = `render:${projectId}:${nonce()}`;
  if (!(await reserveCredits(userId, projectId, pricing.render, "render", chargeRef))) {
    await db().from("projects").update({ status: project.status, job_step: null }).eq("id", projectId);
    return insufficient(userId, pricing.render);
  }
  await db().from("renders").delete().eq("project_id", projectId);
  await send("project/render.requested", { projectId, userId: userId, chargeRef });
  touch();
  return { ok: true };
}

