import "server-only";
import { z } from "zod";
import { claudeJson } from "@/lib/ai/claude";
import { MODERATION_SYSTEM, RETAG_SYSTEM, scriptSystem, type ScriptOptions } from "@/lib/pipeline/prompts";
import {
  countWords,
  DEFAULT_TAG,
  LENGTH_TARGETS,
  normalizeWs,
  validateTagged,
} from "@/lib/pipeline/tags";
import type { Project, Script } from "@/lib/types";
import { db, logEvent } from "@/server/db";
import { projectRules, rulesSection } from "@/server/rules";

export function fullOptions(o: Partial<ScriptOptions> | null | undefined): ScriptOptions {
  return {
    duration: o?.duration === "short" ? "short" : "long",
    tone: o?.tone ?? "drama",
    narration: o?.narration ?? "second_person",
    productName: o?.productName || undefined,
    productIconKey: o?.productIconKey || undefined,
  };
}

export async function loadProject(projectId: string): Promise<Project> {
  const { data, error } = await db().from("projects").select("*").eq("id", projectId).single();
  if (error || !data) throw new Error(`project ${projectId} not found`);
  return data as Project;
}

export async function latestScript(projectId: string): Promise<Script | null> {
  const { data } = await db()
    .from("scripts")
    .select("*")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as Script | null;
}

const Moderation = z.object({ allowed: z.boolean(), reason_tr: z.string() });

// İçerik denetimi: gerçek kişi, marka, tanınmış karakter, yetişkin içerik, şiddet.
export async function moderateTopic(project: Project) {
  const o = fullOptions(project.options);
  return claudeJson({
    schema: Moderation,
    system: MODERATION_SYSTEM,
    content: `Topic:\n${project.topic}${o.productName ? `\n\nUser's own product name: ${o.productName}` : ""}`,
    effort: "low",
    maxTokens: 1000,
    ctx: { projectId: project.id, userId: project.user_id, operation: "moderation" },
  });
}

const ScriptOut = z.object({
  title: z.string(),
  plain_text: z.string(),
  tagged_text: z.string(),
  characters: z.array(z.object({ name: z.string(), description_en: z.string() })),
  locations: z.array(z.object({ key: z.string(), description_en: z.string() })),
  vote_options: z.array(z.string()),
  opening_stamp: z.string(),
});
type ScriptOut = z.infer<typeof ScriptOut>;

function checkScript(out: ScriptOut, o: ScriptOptions): string[] {
  const problems = [...validateTagged(out.plain_text, out.tagged_text).problems];
  const words = countWords(out.plain_text);
  const len = LENGTH_TARGETS[o.duration];
  if (words < len.minWords || words > len.maxWords) {
    problems.push(`plain_text has ${words} words; it must have ${len.minWords}-${len.maxWords}`);
  }
  const formal = [...new Set(out.plain_text.match(/\p{L}+[ıiuü]yor\p{L}*/gu) ?? [])];
  if (formal.length) {
    problems.push(
      `Use the colloquial "-yo" ending everywhere, never "-yor" (yazıyor -> yazıyo, görüyorsun -> görüyosun). Found: ${formal.slice(0, 12).join(", ")}`,
    );
  }
  if (!out.plain_text.includes("Neden olmasın?")) problems.push('"Neden olmasın?" is missing');
  if (!out.plain_text.includes("Yorumlara tek kelime yaz.")) problems.push("The fixed closing is missing");
  if (out.vote_options.length !== 2) problems.push("vote_options must have exactly 2 items");
  if (out.characters.length < 1) problems.push("At least one character is required");
  if (out.locations.length < 1) problems.push("At least one location is required");
  if (o.productName) {
    const n = out.plain_text.toLocaleLowerCase("tr-TR").split(o.productName.toLocaleLowerCase("tr-TR")).length - 1;
    if (n > 1) problems.push(`The product name appears ${n} times; the maximum is once`);
  }
  return problems;
}

// A) script.generate. instruction verilirse mevcut metin o yönde yeniden yazılır.
export async function generateScript(projectId: string, instruction?: string) {
  const project = await loadProject(projectId);
  const o = fullOptions(project.options);
  const previous = await latestScript(projectId);
  const ctx = { projectId, userId: project.user_id, operation: "script.generate" };

  let request = `KONU:\n${project.topic}`;
  if (instruction && previous) {
    const { data: chars } = await db().from("characters").select("name, description_en").eq("project_id", projectId);
    const { data: locs } = await db().from("locations").select("key, description_en").eq("project_id", projectId);
    request += `\n\nMEVCUT METİN:\n${previous.plain_text}\n\nMEVCUT KARAKTERLER:\n${JSON.stringify(chars)}\n\nMEVCUT MEKÂNLAR:\n${JSON.stringify(locs)}\n\nİSTENEN DEĞİŞİKLİK: ${instruction}\nMetni bu yönde yeniden yaz; istenmeyen kısımları mümkün olduğunca koru. Karakter ve mekân tariflerini, hikâye gerektirmedikçe aynen bırak.`;
  }

  const system = scriptSystem(o) + rulesSection(await projectRules(projectId), "script");
  let out = await claudeJson({ schema: ScriptOut, system, content: request, effort: "high", ctx });
  let problems = checkScript(out, o);
  for (let round = 0; round < 2 && problems.length; round++) {
    await logEvent(projectId, "script.generate", "Senaryo doğrulaması başarısız, düzelttiriliyor", { problems }, "warn");
    out = await claudeJson({
      schema: ScriptOut,
      system,
      content: `${request}\n\nÖNCEKİ ÇIKTIN:\n${JSON.stringify(out)}\n\nBu çıktıda şu sorunlar var, hepsini düzeltip tamamını yeniden döndür:\n- ${problems.join("\n- ")}`,
      effort: "medium",
      ctx,
    });
    problems = checkScript(out, o);
  }

  // Etiket eşleşmesi hâlâ sağlanmıyorsa güvenli duruma düş: yalnızca varsayılan etiket.
  if (!validateTagged(out.plain_text, out.tagged_text).ok) {
    await logEvent(projectId, "script.generate", "Etiketli metin eşleşmedi; varsayılan etikete düşüldü", undefined, "warn");
    out.tagged_text = `${DEFAULT_TAG} ${normalizeWs(out.plain_text)}`;
  }
  const remaining = checkScript(out, o);
  if (remaining.length) await logEvent(projectId, "script.generate", "Kalan uyarılar", { problems: remaining }, "warn");

  const version = (previous?.version ?? 0) + 1;
  const { error } = await db().from("scripts").insert({
    project_id: projectId,
    plain_text: out.plain_text.trim(),
    tagged_text: out.tagged_text.trim(),
    word_count: countWords(out.plain_text),
    version,
    vote_options: out.vote_options.slice(0, 2),
    opening_stamp: out.opening_stamp,
  });
  if (error && error.code !== "23505") throw new Error(error.message);

  await db().from("characters").delete().eq("project_id", projectId);
  await db().from("locations").delete().eq("project_id", projectId);
  const names = new Set<string>();
  const characters = out.characters.slice(0, 4).filter((c) => !names.has(c.name) && names.add(c.name));
  await db().from("characters").insert(characters.map((c) => ({ project_id: projectId, ...c })));
  const keys = new Set<string>();
  const locations = out.locations.filter((l) => !keys.has(l.key) && keys.add(l.key));
  await db().from("locations").insert(locations.map((l) => ({ project_id: projectId, ...l })));

  await db()
    .from("projects")
    .update({ title: out.title.slice(0, 80), status: "script", job_step: null, job_error: null })
    .eq("id", projectId);
  await logEvent(projectId, "script.generate", "Senaryo yazıldı", { version, words: countWords(out.plain_text) });
}

const Retag = z.object({ tagged_text: z.string() });

// Kullanıcı metni elle düzenlediyse etiketleri yeniden üretir.
export async function retagScript(projectId: string) {
  const script = await latestScript(projectId);
  if (!script || script.tagged_text) return;
  const project = await loadProject(projectId);
  const ctx = { projectId, userId: project.user_id, operation: "script.retag" };

  let tagged = "";
  let problems: string[] = [];
  for (let round = 0; round < 3; round++) {
    const out = await claudeJson({
      schema: Retag,
      system: RETAG_SYSTEM,
      content:
        round === 0
          ? `METİN:\n${script.plain_text}`
          : `METİN:\n${script.plain_text}\n\nÖNCEKİ DENEMEN:\n${tagged}\n\nSorunlar:\n- ${problems.join("\n- ")}\nDüzeltip yeniden döndür.`,
      effort: "low",
      ctx,
    });
    tagged = out.tagged_text;
    problems = validateTagged(script.plain_text, tagged).problems;
    if (!problems.length) break;
  }
  if (problems.length) {
    await logEvent(projectId, "script.retag", "Etiketleme eşleşmedi; varsayılan etikete düşüldü", { problems }, "warn");
    tagged = `${DEFAULT_TAG} ${normalizeWs(script.plain_text)}`;
  }
  await db().from("scripts").update({ tagged_text: tagged.trim() }).eq("id", script.id);
}
