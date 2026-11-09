import "server-only";
import { z } from "zod";
import { claudeJson } from "@/lib/ai/claude";
import { uploadReference } from "@/lib/ai/replicate";
import { findPhrase } from "@/lib/pipeline/align";
import { framePlanSystem, QC_SYSTEM } from "@/lib/pipeline/prompts";
import { splitWords } from "@/lib/pipeline/tags";
import { contentTypeFor, getObject, isLocalStorage, signedUrl } from "@/lib/storage";
import type { Character, Frame, Location, QcResult } from "@/lib/types";
import { db, logEvent } from "@/server/db";
import { fullOptions, latestScript, loadProject } from "./script";

const KINDS = ["normal", "opening", "problem", "final", "reveal", "closing"] as const;

const Plan = z.object({
  frames: z.array(
    z.object({
      sentence: z.string(),
      start_phrase: z.string(),
      kind: z.enum(KINDS),
      shot_prompt_en: z.string(),
      character_ids: z.array(z.string()),
      location_key: z.string(),
      uses_product: z.boolean(),
    }),
  ),
});
type Plan = z.infer<typeof Plan>;

export function frameTarget(wordCount: number, duration: "short" | "long") {
  if (duration === "long") return { min: 44, max: 46 };
  const n = Math.round(wordCount / 7);
  return { min: Math.max(8, n - 1), max: n + 1 };
}

// C) frames.plan: metni karelere böler. Var olan plan yeniden üretilmez.
export async function planFrames(projectId: string) {
  const { count } = await db().from("frames").select("id", { count: "exact", head: true }).eq("project_id", projectId);
  if (count && count > 0) return;

  const project = await loadProject(projectId);
  const o = fullOptions(project.options);
  const script = await latestScript(projectId);
  if (!script) throw new Error("no script");
  const { data: chars } = await db().from("characters").select("*").eq("project_id", projectId).order("created_at");
  const { data: locs } = await db().from("locations").select("*").eq("project_id", projectId);
  const characters = (chars ?? []) as Character[];
  const locations = (locs ?? []) as Location[];
  const shortId = new Map(characters.map((c, i) => [`c${i + 1}`, c.id]));
  const target = frameTarget(script.word_count, o.duration);
  const hasProduct = Boolean(o.productName && o.productIconKey);
  const ctx = { projectId, userId: project.user_id, operation: "frames.plan" };

  const request = `NARRATION:\n${script.plain_text}\n\nCHARACTERS (id, name, description):\n${characters
    .map((c, i) => `c${i + 1} | ${c.name} | ${c.description_en}`)
    .join("\n")}\n\nLOCATIONS (key: description):\n${locations.map((l) => `${l.key}: ${l.description_en}`).join("\n")}\n\nVOTE OPTIONS: ${(script.vote_options ?? []).join(" / ")}`;

  const words = splitWords(script.plain_text).map((word) => ({ word, start: 0, end: 0 }));
  const check = (plan: Plan) => {
    const problems: string[] = [];
    const n = plan.frames.length;
    if (n < target.min - 3 || n > target.max + 4) problems.push(`There are ${n} frames; produce ${target.min}-${target.max}`);
    let cursor = 0;
    plan.frames.forEach((f, i) => {
      if (i > 0) {
        const at = findPhrase(words, f.start_phrase, cursor);
        if (at < 0) problems.push(`Frame ${i + 1}: start_phrase "${f.start_phrase}" was not found in the narration after the previous frame`);
        else cursor = at + 1;
      }
      if (f.character_ids.some((id) => !shortId.has(id))) problems.push(`Frame ${i + 1}: unknown character id`);
      if (!locations.some((l) => l.key === f.location_key)) problems.push(`Frame ${i + 1}: unknown location_key "${f.location_key}"`);
    });
    if (plan.frames[0]?.kind !== "opening") problems.push('The first frame must have kind "opening"');
    return problems;
  };

  let plan = await claudeJson({ schema: Plan, system: framePlanSystem(target, hasProduct), content: request, effort: "medium", maxTokens: 32000, ctx });
  let problems = check(plan);
  if (problems.length) {
    await logEvent(projectId, "frames.plan", "Kare planı doğrulaması başarısız, düzelttiriliyor", { problems: problems.slice(0, 20) }, "warn");
    plan = await claudeJson({
      schema: Plan,
      system: framePlanSystem(target, hasProduct),
      content: `${request}\n\nYOUR PREVIOUS PLAN:\n${JSON.stringify(plan)}\n\nFix these problems and return the full plan again:\n- ${problems.slice(0, 30).join("\n- ")}`,
      effort: "medium",
      maxTokens: 32000,
      ctx,
    });
    problems = check(plan);
    if (problems.length) await logEvent(projectId, "frames.plan", "Kalan uyarılar", { problems: problems.slice(0, 20) }, "warn");
  }

  const rows = plan.frames.map((f, index) => ({
    project_id: projectId,
    index,
    sentence: f.sentence,
    // Bulunamayan start_phrase için cümlenin ilk üç kelimesine düş.
    start_phrase: f.start_phrase.trim() || splitWords(f.sentence).slice(0, 3).join(" "),
    kind: index === 0 ? "opening" : f.kind === "opening" ? "normal" : f.kind,
    shot_prompt_en: f.shot_prompt_en,
    character_ids: f.character_ids.map((id) => shortId.get(id)).filter(Boolean).slice(0, 3),
    location_key: locations.some((l) => l.key === f.location_key) ? f.location_key : null,
    uses_product: hasProduct && f.uses_product,
  }));
  const { error } = await db().from("frames").insert(rows);
  if (error && error.code !== "23505") throw new Error(error.message);
  await logEvent(projectId, "frames.plan", "Kare planı hazır", { frames: rows.length });
}

// Replicate'e verilecek referans adresi: R2'de imzalı adres, yerelde Replicate dosya deposu.
export async function referenceUrl(key: string): Promise<string> {
  if (!isLocalStorage) return (await signedUrl(key, 2))!;
  return uploadReference(key, await getObject(key), contentTypeFor(key));
}

const Qc = z.object({
  realistic_face: z.boolean(),
  stray_text: z.boolean(),
  wrong_character: z.boolean(),
  fix_instruction: z.string(),
  notes: z.string(),
});

async function imageBlock(key: string) {
  const bytes = await getObject(key);
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: contentTypeFor(key) as "image/jpeg" | "image/png" | "image/webp",
      data: bytes.toString("base64"),
    },
  };
}

// E) frames.qc: Claude kareyi karakter kartlarıyla karşılaştırır.
export async function qcFrame(frame: Frame, imageKey: string, userId: string): Promise<QcResult> {
  const { data } = frame.character_ids.length
    ? await db().from("characters").select("*").in("id", frame.character_ids)
    : { data: [] };
  const characters = ((data ?? []) as Character[]).filter((c) => c.card_image_url);

  const content = [
    { type: "text" as const, text: "Generated frame:" },
    await imageBlock(imageKey),
    ...(
      await Promise.all(
        characters.map(async (c) => [
          { type: "text" as const, text: `Reference card for ${c.name}:` },
          await imageBlock(c.card_image_url!),
        ]),
      )
    ).flat(),
    {
      type: "text" as const,
      text: characters.length
        ? `Characters expected in the frame: ${characters.map((c) => c.name).join(", ")}.`
        : "No specific characters are expected in this frame.",
    },
  ];
  return claudeJson({
    schema: Qc,
    system: QC_SYSTEM,
    content,
    effort: "low",
    maxTokens: 2000,
    ctx: { projectId: frame.project_id, userId, operation: "frames.qc" },
  });
}

export function qcPassed(qc: QcResult) {
  return !qc.realistic_face && !qc.stray_text && !qc.wrong_character;
}
