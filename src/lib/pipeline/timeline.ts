// Sessizlik kırpma ve kare zamanlaması. Tüm fonksiyonlar saf; ffmpeg çağrısı ayrı.
import { findPhrase, type TimedWord } from "./align";

export const FPS = 30;
export const KEEP_SILENCE = 0.2;
export const KEEP_SILENCE_PROTECTED = 0.55;
export const FRAME_LEAD = 0.12;
export const MIN_FRAME_GAP = 0.8;
export const TAIL = 1.2;

export type Range = { start: number; end: number };

// ffmpeg silencedetect çıktısından sessizlik aralıklarını okur.
export function parseSilences(stderr: string, totalDuration: number): Range[] {
  const out: Range[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) start = Math.max(0, parseFloat(s[1]));
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && start !== null) {
      out.push({ start, end: parseFloat(e[1]) });
      start = null;
    }
  }
  if (start !== null && totalDuration > start) out.push({ start, end: totalDuration });
  return out;
}

// Kesilecek ham zaman aralıklarını (trim_map) üretir. Her sessizlikten `keep`
// saniye bırakılır; korunan bir cümle sessizliğin hemen ardından başlıyorsa
// daha uzun bir boşluk bırakılır.
export function buildTrimMap(silences: Range[], protectedStarts: number[]): Range[] {
  const cuts: Range[] = [];
  for (const s of silences) {
    const isProtected = protectedStarts.some((p) => p >= s.start - 0.05 && p <= s.end + 0.3);
    const keep = isProtected ? KEEP_SILENCE_PROTECTED : KEEP_SILENCE;
    const dur = s.end - s.start;
    if (dur <= keep + 0.01) continue;
    cuts.push({ start: round3(s.start + keep / 2), end: round3(s.end - keep / 2) });
  }
  return cuts;
}

// Ham ses zamanını kırpılmış ses zamanına çevirir.
export function mapTime(t: number, cuts: Range[]): number {
  let removed = 0;
  for (const c of cuts) {
    if (t >= c.end) removed += c.end - c.start;
    else if (t > c.start) removed += t - c.start;
    else break;
  }
  return t - removed;
}

export function trimmedDuration(rawDuration: number, cuts: Range[]): number {
  return rawDuration - cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
}

// Kesilen aralıkları atan ffmpeg ses filtresi.
export function trimFilter(cuts: Range[]): string | null {
  if (!cuts.length) return null;
  const expr = cuts.map((c) => `between(t,${c.start},${c.end})`).join("+");
  return `aselect='not(${expr})',asetpts=N/SR/TB`;
}

export function roundToFrame(t: number): number {
  return Math.round(t * FPS) / FPS;
}

export type FrameTiming = {
  wordIndex: number;
  start_time_raw: number;
  start_time_final: number;
  duration: number;
};

// Her karenin başlangıcı = start_phrase'in ilk kelimesi - 0,12 sn; trim_map ile
// çevrilir, 30 fps'ye yuvarlanır. Kareler arası en az 0,8 sn; sona 1,2 sn kuyruk.
export function buildFrameTimes(
  startPhrases: string[],
  words: TimedWord[],
  cuts: Range[],
  rawDuration: number,
  silences: Range[] = [],
): { frames: FrameTiming[]; total: number; missing: number[] } {
  const total = roundToFrame(trimmedDuration(rawDuration, cuts) + TAIL);
  const frames: FrameTiming[] = [];
  const missing: number[] = [];
  let cursor = 0;

  for (let i = 0; i < startPhrases.length; i++) {
    let idx = i === 0 ? 0 : findPhrase(words, startPhrases[i], cursor);
    if (idx < 0) {
      // Bulunamadı: kalan kelimeleri kalan karelere eşit dağıt.
      missing.push(i);
      idx = Math.min(
        words.length - 1,
        cursor + Math.max(1, Math.floor((words.length - cursor) / (startPhrases.length - i))),
      );
    }
    const raw = i === 0 ? 0 : Math.max(0, speechOnset(words[idx]?.start ?? 0, silences) - FRAME_LEAD);
    let start = roundToFrame(mapTime(raw, cuts));
    if (i > 0) start = Math.max(start, roundToFrame(frames[i - 1].start_time_final + MIN_FRAME_GAP));
    frames.push({ wordIndex: idx, start_time_raw: round3(raw), start_time_final: start, duration: 0 });
    cursor = idx + 1;
  }

  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].start_time_final : total;
    frames[i].duration = round3(Math.max(1 / FPS, next - frames[i].start_time_final));
  }
  return { frames, total: Math.max(total, frames.at(-1)?.start_time_final ?? 0), missing };
}

// TTS zaman damgaları, duraklamadan sonraki kelimenin başlangıcını çoğu zaman
// sessizliğin içine koyar. Kelime bir sessizliğin içinde başlıyorsa gerçek
// başlangıç, sessizliğin bittiği andır.
export function speechOnset(wordStart: number, silences: Range[]): number {
  for (const s of silences) {
    if (wordStart >= s.start - 0.02 && wordStart < s.end) return s.end;
    if (s.start > wordStart) break;
  }
  return wordStart;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Türkçe büyük harf (i -> İ, ı -> I).
export function upperTr(text: string): string {
  return text.toLocaleUpperCase("tr-TR");
}

export type FrameKind = "normal" | "opening" | "problem" | "final" | "reveal" | "closing";

export type DefaultCard = {
  text: string;
  frame_index: number;
  offset: number;
  duration: number;
  size: number;
  y_position: number;
};

const PROBLEM_LABELS = ["BİRİNCİ SORUN", "İKİNCİ SORUN", "ÜÇÜNCÜ SORUN"];

// Varsayılan kartlar: açılış damgası, sorun başlıkları, finalde oylama kartı.
// Oylama kartı, seçeneklerin söylendiği karede açılır ve videonun sonuna kadar kalır.
export function defaultCards(
  frames: { index: number; kind: FrameKind; duration: number; sentence?: string }[],
  openingStamp: string | null,
  voteOptions: string[] | null,
): DefaultCard[] {
  const cards: DefaultCard[] = [];
  if (openingStamp && frames.length) {
    cards.push({
      text: upperTr(openingStamp),
      frame_index: frames[0].index,
      offset: 0.2,
      duration: 2.2,
      size: 64,
      y_position: 0.14,
    });
  }
  let p = 0;
  for (const f of frames) {
    if (f.kind === "problem" && p < PROBLEM_LABELS.length) {
      cards.push({
        text: PROBLEM_LABELS[p++],
        frame_index: f.index,
        offset: 0,
        duration: 1.8,
        size: 110,
        y_position: 0.5,
      });
    }
  }
  if (voteOptions?.length === 2 && frames.length) {
    const lower = (x: string) => x.toLocaleLowerCase("tr-TR");
    const closing = frames.filter((f) => f.kind === "closing");
    const at =
      closing.find((f) => f.sentence && lower(f.sentence).includes(lower(voteOptions[0]))) ??
      closing[0] ??
      frames[frames.length - 1];
    const offset = 0.3;
    const rest = frames.filter((f) => f.index >= at.index).reduce((sum, f) => sum + f.duration, 0);
    cards.push({
      text: upperTr(`${voteOptions[0]} ya da ${voteOptions[1]}`),
      frame_index: at.index,
      offset,
      duration: Math.max(2, Math.round((rest - offset - 0.3) * 10) / 10),
      size: 96,
      y_position: 0.5,
    });
  }
  return cards;
}
