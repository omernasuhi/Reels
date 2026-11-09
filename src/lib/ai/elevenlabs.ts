import "server-only";
import { env } from "@/lib/env";
import { fetchRetry } from "@/lib/http";
import type { CharAlignment, TimedWord } from "@/lib/pipeline/align";

const API = "https://api.elevenlabs.io/v1";

// Zaman damgalı seslendirme. eleven_v3 karakter düzeyinde hizalama döndürür
// (etiket karakterleri dahil; kelimelere çevrilirken atılır).
export async function ttsWithTimestamps(
  text: string,
  voiceId: string,
): Promise<{ audio: Buffer; alignment: CharAlignment | null }> {
  const res = await fetchRetry(
    `${API}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": env.elevenKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: env.elevenModel, language_code: "tr" }),
      timeoutMs: 5 * 60_000,
      retries: 3,
    },
  );
  const json = (await res.json()) as { audio_base64: string; alignment: CharAlignment | null };
  return { audio: Buffer.from(json.audio_base64, "base64"), alignment: json.alignment };
}

// Yedek yol: sesi Scribe ile yazıya döküp kelime zamanlarını alır.
export async function scribeWords(audio: Buffer): Promise<TimedWord[]> {
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("language_code", "tr");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "audio.mp3");
  const res = await fetchRetry(`${API}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": env.elevenKey },
    body: form,
    timeoutMs: 5 * 60_000,
    retries: 3,
  });
  const json = (await res.json()) as { words: { text: string; start: number; end: number; type: string }[] };
  return json.words
    .filter((w) => w.type === "word")
    .map((w) => ({ word: w.text, start: w.start, end: w.end }));
}
