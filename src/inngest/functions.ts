import { NonRetriableError, type GetStepTools } from "inngest";
import { getDict } from "@/i18n";
import {
  createImagePrediction,
  downloadOutput,
  getPrediction,
  isTerminal,
  outputUrl,
  type Prediction,
} from "@/lib/ai/replicate";
import { env, isWebhookReachable } from "@/lib/env";
import { characterCardPrompt, fixPrompt, framePrompt } from "@/lib/pipeline/prompts";
import { putObject } from "@/lib/storage";
import type { Character, Frame, Location } from "@/lib/types";
import { db, getSetting, logCost, logEvent, refundCredits } from "@/server/db";
import { buildTimeline, generateAudio } from "@/server/pipeline/audio";
import { planFrames, qcFrame, qcPassed, referenceUrl } from "@/server/pipeline/frames";
import { renderVariant } from "@/server/pipeline/render";
import { fullOptions, generateScript, loadProject, moderateTopic, retagScript } from "@/server/pipeline/script";
import { inngest, type Events } from "./client";

type Step = GetStepTools<typeof inngest>;
const t = getDict();

function friendly(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("refused")) return t.jobErrors.content;
  if (msg.includes("Ses kimliği")) return t.jobErrors.voice;
  if (/HTTP 401|HTTP 403|anahtarı geçersiz/.test(msg)) return t.jobErrors.auth;
  if (/HTTP 402|quota|insufficient|credit/i.test(msg)) return t.jobErrors.providerQuota;
  return t.jobErrors.generic;
}

async function setJob(projectId: string, patch: Record<string, unknown>) {
  await db().from("projects").update(patch).eq("id", projectId);
}

// onFailure olayından asıl olayın verisini çıkarır.
function original<K extends keyof Events>(event: { data: unknown }): Events[K] {
  return (event.data as { event: { data: Events[K] } }).event.data;
}

// D) Replicate ile görsel üretir ve depoya kopyalar. Her alt adım ayrı bir
// dayanıklı adımdır: yeniden çalıştırmada tamamlanan çağrılar tekrarlanmaz.
async function generateImage(
  step: Step,
  id: string,
  args: { prompt: string; refKeys: string[]; outKey: string; projectId: string; userId: string; operation: string },
): Promise<string> {
  let lastError = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    const sid = `${id}-a${attempt}`;
    let pred: Prediction = await step.run(`${sid}-create`, async () => {
      const refs = await Promise.all(args.refKeys.map(referenceUrl));
      const p = await createImagePrediction(args.prompt, refs);
      const prices = await getSetting("api_prices");
      await logCost(args.projectId, args.userId, "replicate", args.operation, prices.replicate_image, { prediction: p.id });
      return { id: p.id, status: p.status, output: p.output, error: p.error };
    });

    if (!isTerminal(pred) && isWebhookReachable) {
      await step.waitForEvent(`${sid}-webhook`, {
        event: "replicate/prediction.completed",
        timeout: "2m",
        if: `async.data.id == "${pred.id}"`,
      });
    }
    // Yedek: yokla.
    for (let i = 0; i < 50 && !isTerminal(pred); i++) {
      if (i > 0 || !isWebhookReachable) await step.sleep(`${sid}-wait-${i}`, "6s");
      pred = await step.run(`${sid}-poll-${i}`, async () => {
        const p = await getPrediction(pred.id);
        return { id: p.id, status: p.status, output: p.output, error: p.error };
      });
    }

    const url = outputUrl(pred);
    if (pred.status === "succeeded" && url) {
      return step.run(`${sid}-store`, async () => {
        await putObject(args.outKey, await downloadOutput(url), "image/jpeg");
        return args.outKey;
      });
    }
    lastError = pred.error ?? pred.status;
    await step.run(`${sid}-log`, () =>
      logEvent(args.projectId, args.operation, "Görsel üretimi başarısız", { prediction: pred.id, error: lastError, attempt }, "warn"),
    );
  }
  throw new NonRetriableError(`image generation failed: ${lastError}`);
}

// A) script.generate
export const scriptGenerate = inngest.createFunction(
  {
    id: "script-generate",
    triggers: [{ event: "project/script.requested" }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const d = original<"project/script.requested">(event);
      await refundCredits(d.userId, d.chargeRef);
      const { count } = await db().from("scripts").select("id", { count: "exact", head: true }).eq("project_id", d.projectId);
      await setJob(d.projectId, { job_step: null, job_error: friendly(error), status: count ? "script" : "draft" });
      await logEvent(d.projectId, "script.generate", "Başarısız", { error: error.message }, "error");
    },
  },
  async ({ event, step }) => {
    const d = event.data as Events["project/script.requested"];
    if (!d.instruction) {
      const verdict = await step.run("moderate", async () => moderateTopic(await loadProject(d.projectId)));
      if (!verdict.allowed) {
        await step.run("reject", async () => {
          await refundCredits(d.userId, d.chargeRef);
          await setJob(d.projectId, { status: "draft", job_step: null, job_error: verdict.reason_tr || t.jobErrors.content });
          await logEvent(d.projectId, "moderation", "Konu reddedildi", { reason: verdict.reason_tr }, "warn");
        });
        return { rejected: true };
      }
    }
    await step.run("generate", () => generateScript(d.projectId, d.instruction));
    return { ok: true };
  },
);

// Senaryo onayı sonrası: etiketleme (gerekirse), karakter kartları ve kare planı.
export const prepareProduction = inngest.createFunction(
  {
    id: "production-prepare",
    triggers: [{ event: "project/script.approved" }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const d = original<"project/script.approved">(event);
      await setJob(d.projectId, { job_step: null, job_error: friendly(error) });
      await logEvent(d.projectId, "frames.plan", "Başarısız", { error: error.message }, "error");
    },
  },
  async ({ event, step }) => {
    const d = event.data as Events["project/script.approved"];
    await step.run("retag", () => retagScript(d.projectId));
    await step.run("plan-frames", () => planFrames(d.projectId));
    await step.run("done", () => setJob(d.projectId, { job_step: null }));
  },
);

// B) characters.generate (her karakter ayrı çalışır, paralel)
export const characterGenerate = inngest.createFunction(
  {
    id: "characters-generate",
    triggers: [{ event: "character/generate.requested" }],
    concurrency: { limit: env.imageConcurrency },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const d = original<"character/generate.requested">(event);
      await refundCredits(d.userId, d.chargeRef);
      await db().from("characters").update({ status: "error" }).eq("id", d.characterId);
      await logEvent(d.projectId, "characters.generate", "Başarısız", { error: error.message, character: d.characterId }, "error");
    },
  },
  async ({ event, step }) => {
    const d = event.data as Events["character/generate.requested"];
    const character = await step.run("load", async () => {
      const { data } = await db().from("characters").select("*").eq("id", d.characterId).single();
      await db().from("characters").update({ status: "generating" }).eq("id", d.characterId);
      return data as Character;
    });
    const key = await generateImage(step, "card", {
      prompt: characterCardPrompt(character.name, character.description_en),
      refKeys: [],
      outKey: `projects/${d.projectId}/characters/${d.characterId}-${event.id}.jpg`,
      projectId: d.projectId,
      userId: d.userId,
      operation: "characters.generate",
    });
    await step.run("save", async () => {
      await db().from("characters").update({ card_image_url: key, status: "ready", approved_at: null }).eq("id", d.characterId);
      await logEvent(d.projectId, "characters.generate", "Karakter kartı hazır", { character: character.name });
    });
  },
);

// Üretim bittiyse projeyi önizlemeye geçirir.
async function finalizeProject(projectId: string) {
  const project = await loadProject(projectId);
  const { data: frames } = await db().from("frames").select("index, status, image_url").eq("project_id", projectId).order("index");
  if (project.status === "producing") {
    const { data: audio } = await db().from("audio").select("trimmed_url").eq("project_id", projectId).maybeSingle();
    const done = (frames ?? []).every((f) => (f.status === "ready" || f.status === "review") && f.image_url);
    if (audio?.trimmed_url && frames?.length && done) {
      await setJob(projectId, { status: "preview", job_step: null, job_error: null, cover_image_url: frames[0].image_url });
      await logEvent(projectId, "production", "Üretim tamamlandı, önizleme hazır");
    }
  } else if (frames?.[0]?.image_url && project.cover_image_url !== frames[0].image_url) {
    await setJob(projectId, { cover_image_url: frames[0].image_url });
  }
}

// D + E) frames.generate ve frames.qc
export const frameGenerate = inngest.createFunction(
  {
    id: "frames-generate",
    triggers: [{ event: "frame/generate.requested" }],
    concurrency: { limit: env.imageConcurrency },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const d = original<"frame/generate.requested">(event);
      if (d.chargeRef) await refundCredits(d.userId, d.chargeRef);
      // Önceki görsel varsa kare kullanılabilir kalır; yoksa hata durumuna geçer.
      const { data: f } = await db().from("frames").select("image_url").eq("id", d.frameId).single();
      await db().from("frames").update({ status: f?.image_url && d.mode === "regen" ? "ready" : "error" }).eq("id", d.frameId);
      await logEvent(d.projectId, "frames.generate", "Kare başarısız", { error: error.message, frame: d.frameId }, "error");
    },
  },
  async ({ event, step }) => {
    const d = event.data as Events["frame/generate.requested"];
    const ctx = await step.run("load", async () => {
      const { data } = await db().from("frames").select("*").eq("id", d.frameId).single();
      const frame = data as Frame;
      if (d.mode === "initial" && (frame.status === "ready" || frame.status === "review")) return null;
      const project = await loadProject(d.projectId);
      const { data: chars } = frame.character_ids.length
        ? await db().from("characters").select("*").in("id", frame.character_ids)
        : { data: [] };
      const { data: loc } = frame.location_key
        ? await db().from("locations").select("*").eq("project_id", d.projectId).eq("key", frame.location_key).maybeSingle()
        : { data: null };
      // Referans sırası karedeki karakter sırasıyla aynı olsun.
      const cards = frame.character_ids
        .map((id) => ((chars ?? []) as Character[]).find((c) => c.id === id)?.card_image_url)
        .filter((k): k is string => Boolean(k));
      const icon = frame.uses_product ? fullOptions(project.options).productIconKey : undefined;
      await db().from("frames").update({ status: "generating" }).eq("id", d.frameId);
      return {
        frame,
        cards,
        refKeys: icon ? [...cards, icon] : cards,
        prompt: framePrompt(frame.shot_prompt_en, (loc as Location | null)?.description_en ?? null),
      };
    });
    if (!ctx) return { skipped: true };

    const base = `projects/${d.projectId}/frames/${String(ctx.frame.index).padStart(3, "0")}-${event.id}`;
    const common = { projectId: d.projectId, userId: d.userId };
    let imageKey = await generateImage(step, "gen", {
      ...common,
      prompt: ctx.prompt,
      refKeys: ctx.refKeys,
      outKey: `${base}.jpg`,
      operation: "frames.generate",
    });

    // Kalite kontrol + en fazla 2 otomatik düzeltme (kullanıcıdan kredi düşmez).
    let attempts = 1;
    for (let fix = 0; ; fix++) {
      const qc = await step.run(`qc-${fix}`, async () => {
        await db().from("frames").update({ status: "checking", image_url: imageKey, attempt_count: attempts }).eq("id", d.frameId);
        return qcFrame(ctx.frame, imageKey, d.userId);
      });
      if (qcPassed(qc) || fix >= 2) {
        await step.run("finish", async () => {
          const status = qcPassed(qc) ? "ready" : "review";
          await db().from("frames").update({ status, qc_result: qc }).eq("id", d.frameId);
          if (status === "review") {
            await logEvent(d.projectId, "frames.qc", "Kare gözden geçirme bekliyor", { frame: ctx.frame.index, qc }, "warn");
          }
          await finalizeProject(d.projectId);
        });
        return { status: qcPassed(qc) ? "ready" : "review", attempts };
      }
      await step.run(`mark-fix-${fix}`, async () => {
        await db().from("frames").update({ status: "fixing", qc_result: qc }).eq("id", d.frameId);
      });
      const change =
        qc.fix_instruction ||
        (qc.realistic_face
          ? "replace every realistic face with a round pure-white cartoon face with tiny dot eyes"
          : qc.stray_text
            ? "remove all text, letters and logos"
            : "make the characters match their reference cards exactly");
      imageKey = await generateImage(step, `fix-${fix}`, {
        ...common,
        prompt: fixPrompt(change),
        refKeys: [imageKey, ...ctx.cards],
        outKey: `${base}-fix${fix + 1}.jpg`,
        operation: "frames.fix",
      });
      attempts++;
    }
  },
);

// Üretim: kareleri kuyruğa atar, paralelde ses ve zaman çizelgesini hazırlar.
export const production = inngest.createFunction(
  {
    id: "production-run",
    triggers: [{ event: "project/production.requested" }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const d = original<"project/production.requested">(event);
      // Ses ya da zamanlama başarısız: toplu rezervi iade et, kullanıcı yeniden başlatabilsin.
      await refundCredits(d.userId, d.chargeRef);
      await setJob(d.projectId, { status: "characters", job_step: null, job_error: friendly(error) });
      await logEvent(d.projectId, "production", "Başarısız", { error: error.message }, "error");
    },
  },
  async ({ event, step }) => {
    const d = event.data as Events["project/production.requested"];
    const frameIds = await step.run("load-frames", async () => {
      const { data } = await db().from("frames").select("id").eq("project_id", d.projectId).order("index");
      return (data ?? []).map((f) => f.id as string);
    });
    await step.sendEvent(
      "queue-frames",
      frameIds.map((frameId) => ({
        name: "frame/generate.requested",
        data: { frameId, projectId: d.projectId, userId: d.userId, mode: "initial" as const },
      })),
    );
    await step.run("audio", async () => {
      await setJob(d.projectId, { job_step: "audio" });
      await generateAudio(d.projectId);
    });
    await step.run("timeline", async () => {
      await setJob(d.projectId, { job_step: "timeline" });
      await buildTimeline(d.projectId);
      await setJob(d.projectId, { job_step: "frames" });
      await finalizeProject(d.projectId);
    });
  },
);

// H) render.video: kartlı ve temiz varyant
export const renderVideo = inngest.createFunction(
  {
    id: "render-video",
    triggers: [{ event: "project/render.requested" }],
    concurrency: { limit: 1 },
    retries: 1,
    onFailure: async ({ event, error }) => {
      const d = original<"project/render.requested">(event);
      await refundCredits(d.userId, d.chargeRef);
      await db().from("renders").update({ status: "error" }).eq("project_id", d.projectId).neq("status", "done");
      await setJob(d.projectId, { status: "preview", job_step: null, job_error: t.jobErrors.render });
      await logEvent(d.projectId, "render.video", "Başarısız", { error: error.message }, "error");
    },
  },
  async ({ event, step }) => {
    const d = event.data as Events["project/render.requested"];
    await step.run("render-cards", async () => {
      await setJob(d.projectId, { job_step: "render_cards", job_started_at: new Date().toISOString() });
      await renderVariant(d.projectId, "cards");
    });
    await step.run("render-clean", async () => {
      await setJob(d.projectId, { job_step: "render_clean" });
      await renderVariant(d.projectId, "clean");
    });
    await step.run("done", async () => {
      await setJob(d.projectId, { status: "done", job_step: null, job_error: null });
      await logEvent(d.projectId, "render.video", "Dışa aktarma tamamlandı");
    });
  },
);

export const functions = [scriptGenerate, prepareProduction, characterGenerate, frameGenerate, production, renderVideo];
