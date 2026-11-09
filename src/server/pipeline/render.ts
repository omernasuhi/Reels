import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { env, isLambdaConfigured } from "@/lib/env";
import { FPS, TAIL } from "@/lib/pipeline/timeline";
import { putObject, signedUrl } from "@/lib/storage";
import type { AudioRow, Card, Frame } from "@/lib/types";
import type { StoryProps } from "@/remotion/types";
import { db, getSetting, logCost, logEvent } from "@/server/db";
import { loadProject } from "./script";

const run = promisify(execFile);

// Kompozisyon girdisi. Önizleme (Player) ve render aynı fonksiyondan beslenir.
export async function buildStoryProps(projectId: string, showCards: boolean, ttlHours = 2): Promise<StoryProps | null> {
  const [{ data: frameRows }, { data: audioData }, { data: cardRows }] = await Promise.all([
    db().from("frames").select("*").eq("project_id", projectId).order("index"),
    db().from("audio").select("*").eq("project_id", projectId).maybeSingle(),
    db().from("cards").select("*").eq("project_id", projectId),
  ]);
  const frames = (frameRows ?? []) as Frame[];
  const audio = audioData as AudioRow | null;
  if (!audio?.trimmed_url || !audio.trimmed_duration || !frames.length) return null;
  if (frames.some((f) => f.start_time_final === null)) return null;

  const total = Math.max(
    audio.trimmed_duration + TAIL,
    (frames.at(-1)!.start_time_final ?? 0) + (frames.at(-1)!.duration ?? 0),
  );
  const byIndex = new Map(frames.map((f) => [f.index, f]));
  return {
    frames: await Promise.all(
      frames.map(async (f) => ({
        url: await signedUrl(f.image_url, ttlHours),
        start: f.start_time_final!,
        duration: f.duration!,
        kind: f.kind,
        alt: f.sentence,
      })),
    ),
    audioUrl: (await signedUrl(audio.trimmed_url, ttlHours))!,
    cards: ((cardRows ?? []) as Card[])
      .filter((c) => c.enabled && byIndex.has(c.frame_index))
      .map((c) => ({
        text: c.text,
        start: byIndex.get(c.frame_index)!.start_time_final! + c.offset,
        duration: c.duration,
        size: c.size,
        y: c.y_position,
      })),
    showCards,
    durationInFrames: Math.ceil(total * FPS),
  };
}

// H) render.video: iki varyant (kartlı ve temiz). Tamamlanan varyant yeniden üretilmez.
export async function renderVariant(projectId: string, variant: "cards" | "clean") {
  const { data: existing } = await db().from("renders").select("*").eq("project_id", projectId).eq("variant", variant).maybeSingle();
  if (existing?.status === "done" && existing.video_url) return;

  const project = await loadProject(projectId);
  const props = await buildStoryProps(projectId, variant === "cards", 6);
  if (!props) throw new Error("timeline not ready");
  await db().from("renders").upsert({ project_id: projectId, variant, status: "rendering", video_url: null }, { onConflict: "project_id,variant" });

  const key = `projects/${projectId}/renders/${variant}-${Date.now()}.mp4`;
  const video = isLambdaConfigured ? await renderOnLambda(props) : await renderLocally(props);
  await putObject(key, video, "video/mp4");

  await db().from("renders").update({ status: "done", video_url: key, duration: props.durationInFrames / FPS })
    .eq("project_id", projectId).eq("variant", variant);
  const prices = await getSetting("api_prices");
  await logCost(projectId, project.user_id, isLambdaConfigured ? "remotion-lambda" : "remotion-local", `render.${variant}`, prices.render);
  await logEvent(projectId, "render.video", `Render tamamlandı: ${variant}`, { bytes: video.length });
}

// Yerel geliştirme: @remotion/renderer ayrı bir Node sürecinde çalışır
// (paketleyici Next.js sunucu derlemesinin içine alınamaz).
async function renderLocally(props: StoryProps): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reels-render-"));
  try {
    const propsFile = path.join(dir, "props.json");
    const outFile = path.join(dir, "out.mp4");
    await fs.writeFile(propsFile, JSON.stringify(props));
    await run(process.execPath, [path.resolve("scripts/render-local.mjs"), propsFile, outFile], {
      cwd: process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
      timeout: 45 * 60 * 1000,
      env: { ...process.env, REMOTION_BROWSER_EXECUTABLE: env.remotionBrowserExecutable },
    });
    return await fs.readFile(outFile);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function renderOnLambda(props: StoryProps): Promise<Buffer> {
  const { renderMediaOnLambda, getRenderProgress } = await import("@remotion/lambda/client");
  const region = env.remotionRegion as Parameters<typeof renderMediaOnLambda>[0]["region"];
  const { renderId, bucketName } = await renderMediaOnLambda({
    region,
    functionName: env.remotionFunctionName,
    serveUrl: env.remotionServeUrl,
    composition: "Story",
    inputProps: props,
    codec: "h264",
    privacy: "private",
    downloadBehavior: { type: "download", fileName: "video.mp4" },
  });
  for (let i = 0; i < 360; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const progress = await getRenderProgress({ renderId, bucketName, functionName: env.remotionFunctionName, region });
    if (progress.fatalErrorEncountered) throw new Error(progress.errors[0]?.message ?? "Lambda render failed");
    if (progress.done && progress.outKey) {
      const { presignUrl } = await import("@remotion/lambda/client");
      const url = await presignUrl({ region, bucketName, objectKey: progress.outKey, expiresInSeconds: 900 });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Lambda output download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
  }
  throw new Error("Lambda render timed out");
}
