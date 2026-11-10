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
import { characterCardPrompt, FACE_RULE, fixPrompt, framePrompt, TEXT_BAN } from "@/lib/pipeline/prompts";
import { putObject } from "@/lib/storage";
import type { Character, Frame, Location } from "@/lib/types";
import { db, getSetting, logCost, logEvent, refundCredits } from "@/server/db";
import { buildTimeline, generateAudio } from "@/server/pipeline/audio";
import { planFrames, qcFrame, qcPassed, referenceUrl } from "@/server/pipeline/frames";
import { renderVariant } from "@/server/pipeline/render";
import { fullOptions, generateScript, loadProject, moderateTopic, retagScript } from "@/server/pipeline/script";
import { inngest, type Events } from "./client";

const PILOT_FRAMES = 4;

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

// D) Replicate ile görsel üretir ve depoya kopyalar. Tek bir dayanıklı adımdır;
// adım sürdükçe eşzamanlılık hakkını elinde tutar, böylece aynı anda en fazla
// IMAGE_CONCURRENCY tahmin çalışır. Tahmin kimliği oluşturulur oluşturulmaz
// satıra yazılır: adım yeniden çalışırsa yeni tahmin açmaz (iki kez ödeme yok),
// var olanı beklemeye devam eder.
async function generateImage(
  step: Step,
  id: string,
  args: {
    prompt: string;
    refKeys: string[];
    outKey: string;
    projectId: string;
    userId: string;
    operation: string;
    table: "frames" | "characters";
    rowId: string;
  },
): Promise<string> {
  let lastError = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    const sid = `${id}-a${attempt}`;
    const result = await step.run(sid, async () => {
      const { data: row } = await db().from(args.table).select("replicate_prediction_id").eq("id", args.rowId).single();
      const saved = row?.replicate_prediction_id as string | null;
      let pred: Prediction;
      if (saved?.startsWith(`${sid}:`)) {
        pred = await getPrediction(saved.slice(sid.length + 1));
      } else {
        const refs = await Promise.all(args.refKeys.map(referenceUrl));
        pred = await createImagePrediction(args.prompt, refs);
        await db().from(args.table).update({ replicate_prediction_id: `${sid}:${pred.id}` }).eq("id", args.rowId);
        const prices = await getSetting("api_prices");
        await logCost(args.projectId, args.userId, "replicate", args.operation, prices.replicate_image, { prediction: pred.id });
      }

      // Webhook sonucu geldiyse onu kullan; yoksa aralıklı yokla.
      const deadline = Date.now() + 4 * 60 * 1000;
      for (let i = 0; !isTerminal(pred) && Date.now() < deadline; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const { data: hook } = await db().from("replicate_results").select("payload").eq("prediction_id", pred.id).maybeSingle();
        if (hook) pred = hook.payload as Prediction;
        else if (!isWebhookReachable || i % 5 === 4) pred = await getPrediction(pred.id);
      }
      if (!isTerminal(pred)) throw new Error(`prediction ${pred.id} still running`); // adım yeniden denenir, aynı tahmini bekler

      const url = outputUrl(pred);
      if (pred.status === "succeeded" && url) {
        await putObject(args.outKey, await downloadOutput(url), "image/jpeg");
        return { ok: true as const, error: "" };
      }
      const error = pred.error ?? pred.status;
      await logEvent(args.projectId, args.operation, "Görsel üretimi başarısız", { prediction: pred.id, error, attempt }, "warn");
      return { ok: false as const, error };
    });
    if (result.ok) return args.outKey;
    lastError = result.error;
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
    retries: 3,
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
      const row = data as Character;
      // Yeni bir istek: önceki tahmin kimliği bu çalışmaya ait değil.
      await db().from("characters").update({ status: "generating", replicate_prediction_id: null }).eq("id", d.characterId);
      return row;
    });
    // Düzeltme: mevcut kart referans alınır, yalnızca istenen değişiklik uygulanır.
    const fixing = Boolean(d.fix && character.card_image_url);
    const key = await generateImage(step, "card", {
      prompt: fixing ? `${fixPrompt(d.fix!)} ${FACE_RULE} ${TEXT_BAN}` : characterCardPrompt(character.name, character.description_en),
      refKeys: fixing ? [character.card_image_url!] : [],
      outKey: `projects/${d.projectId}/characters/${d.characterId}-${event.id}.jpg`,
      projectId: d.projectId,
      userId: d.userId,
      operation: "characters.generate",
      table: "characters",
      rowId: d.characterId,
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
  if (project.status === "producing" && project.job_step === "pilot") {
    // Pilot: ilk kareler bitince kullanıcının stil onayı beklenir.
    const pilot = (frames ?? []).filter((f) => f.status !== "queued");
    if (pilot.length && pilot.every((f) => (f.status === "ready" || f.status === "review") && f.image_url)) {
      await setJob(projectId, { job_step: "pilot_review", cover_image_url: frames![0].image_url });
      await logEvent(projectId, "production", "Pilot kareler hazır, onay bekleniyor");
    }
  } else if (project.status === "producing" && project.job_step !== "pilot_review") {
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
    retries: 3,
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
      await db().from("frames").update({ status: "generating", replicate_prediction_id: null }).eq("id", d.frameId);
      return {
        frame,
        cards,
        refKeys: icon ? [...cards, icon] : cards,
        prompt: framePrompt(frame.shot_prompt_en, (loc as Location | null)?.description_en ?? null),
      };
    });
    if (!ctx) return { skipped: true };

    const base = `projects/${d.projectId}/frames/${String(ctx.frame.index).padStart(3, "0")}-${event.id}`;
    const common = { projectId: d.projectId, userId: d.userId, table: "frames" as const, rowId: d.frameId };
    const fixing = Boolean(d.fix && ctx.frame.image_url);
    let imageKey = await generateImage(step, "gen", {
      ...common,
      prompt: fixing ? fixPrompt(d.fix!) : ctx.prompt,
      refKeys: fixing ? [ctx.frame.image_url!, ...ctx.cards] : ctx.refKeys,
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
      // Kareler zaten varsa (devam ya da ses yenileme) proje geri alınmaz.
      const { count } = await db().from("frames").select("id", { count: "exact", head: true }).eq("project_id", d.projectId).not("image_url", "is", null);
      const patch = d.freshAudio
        ? { status: "preview", job_step: null } // eski ses yerinde duruyor
        : count
          ? { job_step: d.resume ? "pilot_review" : null }
          : { status: "characters", job_step: null };
      await setJob(d.projectId, { ...patch, job_error: friendly(error) });
      await logEvent(d.projectId, "production", "Başarısız", { error: error.message }, "error");
    },
  },
  async ({ event, step }) => {
    const d = event.data as Events["project/production.requested"];
    const frameIds = await step.run("load-frames", async () => {
      const { data } = await db().from("frames").select("id, status").eq("project_id", d.projectId).order("index");
      const rows = d.pilot ? (data ?? []).slice(0, PILOT_FRAMES) : (data ?? []);
      // Devam ya da yeniden çalıştırmada biten kareler yeniden kuyruğa girmez.
      return rows.filter((f) => f.status === "queued" || f.status === "error").map((f) => f.id as string);
    });
    await step.sendEvent(
      "queue-frames",
      frameIds.map((frameId) => ({
        name: "frame/generate.requested",
        data: { frameId, projectId: d.projectId, userId: d.userId, mode: "initial" as const },
      })),
    );
    if (d.pilot) return { pilot: true };
    await step.run("audio", async () => {
      await setJob(d.projectId, { job_step: "audio" });
      await generateAudio(d.projectId, Boolean(d.freshAudio));
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
