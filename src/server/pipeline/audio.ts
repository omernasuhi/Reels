import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { scribeWords, ttsWithTimestamps } from "@/lib/ai/elevenlabs";
import { env } from "@/lib/env";
import { alignWords, charsToWords, findPhrase, type TimedWord } from "@/lib/pipeline/align";
import { buildFrameTimes, buildTrimMap, defaultCards, parseSilences, speechOnset, trimFilter } from "@/lib/pipeline/timeline";
import { getObject, putObject } from "@/lib/storage";
import type { AudioRow, Frame } from "@/lib/types";
import { db, getSetting, logCost, logEvent } from "@/server/db";
import { latestScript, loadProject } from "./script";

const run = promisify(execFile);

async function audioRow(projectId: string): Promise<AudioRow | null> {
  const { data } = await db().from("audio").select("*").eq("project_id", projectId).maybeSingle();
  return data as AudioRow | null;
}

// F) audio.generate: seslendirme + kelime zamanlamaları. Var olan ses yeniden üretilmez.
// force: var olan sesin yerine yenisini üretir (eski ses, yenisi hazır olana kadar korunur).
export async function generateAudio(projectId: string, force = false) {
  const existing = await audioRow(projectId);
  if (existing?.raw_url && existing.words && !force) return;

  const project = await loadProject(projectId);
  const script = await latestScript(projectId);
  if (!script?.tagged_text) throw new Error("no tagged script");
  const { data: profile } = await db().from("profiles").select("default_voice_id").eq("id", project.user_id).single();
  const voiceId = profile?.default_voice_id || env.elevenVoiceId;
  if (!voiceId) throw new Error("Ses kimliği ayarlanmamış (ELEVENLABS_VOICE_ID ya da Ayarlar > Varsayılan ses).");

  const prices = await getSetting("api_prices");
  const key = `projects/${projectId}/audio/raw-${Date.now()}.mp3`;

  const { audio, alignment } = await ttsWithTimestamps(script.tagged_text, voiceId);
  await putObject(key, audio, "audio/mpeg");
  await logCost(projectId, project.user_id, "elevenlabs", "tts", (script.tagged_text.length / 1000) * prices.elevenlabs_per_1k_chars, {
    characters: script.tagged_text.length,
    voice_id: voiceId,
  });

  // Önce TTS'in kendi zaman damgaları; yoksa ya da metinle tutmuyorsa Scribe.
  let spoken: TimedWord[] = alignment ? charsToWords(alignment) : [];
  let source = "tts";
  let result = alignWords(script.plain_text, spoken);
  if (!spoken.length || result.unmatched > result.words.length * 0.1) {
    spoken = await scribeWords(audio);
    source = "scribe";
    result = alignWords(script.plain_text, spoken);
    const last = spoken.at(-1)?.end ?? 0;
    await logCost(projectId, project.user_id, "elevenlabs", "scribe", (last / 60) * prices.scribe_per_minute);
  }
  if (!result.exact) {
    await logEvent(projectId, "audio.generate", "Kelime dizisi metinle birebir eşleşmedi; hizalama yapıldı", {
      source,
      unmatched: result.unmatched,
      spoken: spoken.length,
      expected: result.words.length,
    }, "warn");
  }

  await db().from("audio").upsert({ project_id: projectId, raw_url: key, words: result.words });
  await logEvent(projectId, "audio.generate", "Seslendirme hazır", { source, words: result.words.length });
}

async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run(env.ffprobePath, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return parseFloat(stdout.trim());
}

// G) timeline.build: sessizlik kırpma, trim_map, kare zamanları, varsayılan kartlar.
export async function buildTimeline(projectId: string) {
  const audio = await audioRow(projectId);
  if (!audio?.raw_url || !audio.words) throw new Error("audio not ready");
  const script = await latestScript(projectId);
  const { data: frameRows } = await db().from("frames").select("*").eq("project_id", projectId).order("index");
  const frames = (frameRows ?? []) as Frame[];
  if (!frames.length) throw new Error("no frames");
  const words = audio.words;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reels-audio-"));
  try {
    const rawFile = path.join(dir, "raw.mp3");
    const outFile = path.join(dir, "trimmed.mp3");
    await fs.writeFile(rawFile, await getObject(audio.raw_url));
    const rawDuration = await probeDuration(rawFile);

    const { stderr } = await run(env.ffmpegPath, [
      "-hide_banner", "-i", rawFile, "-af", "silencedetect=noise=-35dB:d=0.2", "-f", "null", "-",
    ]);
    const silences = parseSilences(stderr, rawDuration);

    // Uzun boşluk bırakılacak yerler: sorun başlıkları, final sahnesi, "Göremediğin şey", kapanış.
    const protectedStarts: number[] = [];
    let cursor = 0;
    let closingSeen = false;
    for (const f of frames) {
      const at = f.index === 0 ? 0 : findPhrase(words, f.start_phrase, cursor);
      if (at < 0) continue;
      cursor = at + 1;
      const isProtected =
        f.kind === "problem" || f.kind === "final" || f.kind === "reveal" || (f.kind === "closing" && !closingSeen);
      if (f.kind === "closing") closingSeen = true;
      if (isProtected) protectedStarts.push(speechOnset(words[at].start, silences));
    }

    const cuts = buildTrimMap(silences, protectedStarts);
    const filter = trimFilter(cuts);
    await run(env.ffmpegPath, [
      "-hide_banner", "-y", "-i", rawFile, ...(filter ? ["-af", filter] : []),
      "-c:a", "libmp3lame", "-b:a", "160k", outFile,
    ]);
    const trimmedDur = await probeDuration(outFile);
    const trimmedKey = `projects/${projectId}/audio/trimmed-${Date.now()}.mp3`;
    await putObject(trimmedKey, await fs.readFile(outFile), "audio/mpeg");

    const timing = buildFrameTimes(frames.map((f) => f.start_phrase), words, cuts, rawDuration, silences);
    if (timing.missing.length) {
      await logEvent(projectId, "timeline.build", "Bazı karelerin başlangıç ifadesi seste bulunamadı; yaklaşık yerleştirildi", { frames: timing.missing }, "warn");
    }
    await Promise.all(
      frames.map((f, i) =>
        db().from("frames").update({
          start_time_raw: timing.frames[i].start_time_raw,
          start_time_final: timing.frames[i].start_time_final,
          duration: timing.frames[i].duration,
        }).eq("id", f.id),
      ),
    );
    await db().from("audio").update({
      trimmed_url: trimmedKey,
      raw_duration: rawDuration,
      trimmed_duration: trimmedDur,
      trim_map: cuts,
    }).eq("project_id", projectId);

    const { count } = await db().from("cards").select("id", { count: "exact", head: true }).eq("project_id", projectId);
    if (!count) {
      const cards = defaultCards(
        frames.map((f, i) => ({ index: f.index, kind: f.kind, duration: timing.frames[i].duration, sentence: f.sentence })),
        script?.opening_stamp ?? null,
        script?.vote_options ?? null,
      );
      if (cards.length) await db().from("cards").insert(cards.map((c) => ({ project_id: projectId, ...c })));
    }
    await logEvent(projectId, "timeline.build", "Zaman çizelgesi hazır", {
      raw: rawDuration, trimmed: trimmedDur, cuts: cuts.length, silences: silences.length,
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
