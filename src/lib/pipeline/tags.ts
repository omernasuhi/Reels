// Ses etiketleri: tagged_text, plain_text ile kelimesi kelimesine aynı olmalı;
// tek fark köşeli parantezli etiketlerdir.

export const DEFAULT_TAG = "[low, steady voice]";
export const URGENCY_TAG = "[low, steady voice, restrained urgency]";
export const MAX_URGENCY = 5;

export const ALLOWED_TAGS = [
  DEFAULT_TAG,
  "[slowly]",
  "[sarcastic]",
  "[deadpan]",
  "[curious]",
  "[calm, confident]",
  "[smug, condescending]",
  "[annoyed, shouting]",
  "[pause]",
  URGENCY_TAG,
] as const;

const TAG_RE = /\[[^\]]*\]/g;

export function normalizeWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function stripTags(tagged: string): string {
  return normalizeWs(tagged.replace(TAG_RE, " "));
}

export function extractTags(tagged: string): string[] {
  return tagged.match(TAG_RE) ?? [];
}

export type TagCheck = { ok: boolean; problems: string[] };

// Etiketler silinince metin birebir aynı mı, yalnızca izinli etiketler mi var?
export function validateTagged(plain: string, tagged: string): TagCheck {
  const problems: string[] = [];
  const tags = extractTags(tagged);
  const allowed = new Set<string>(ALLOWED_TAGS);
  const unknown = [...new Set(tags.filter((t) => !allowed.has(t)))];
  if (unknown.length) problems.push(`Unknown tags: ${unknown.join(" ")}`);

  const urgency = tags.filter((t) => t === URGENCY_TAG).length;
  if (urgency > MAX_URGENCY) {
    problems.push(`${URGENCY_TAG} used ${urgency} times; the maximum is ${MAX_URGENCY}`);
  }

  const a = normalizeWs(plain);
  const b = stripTags(tagged);
  if (a !== b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const from = Math.max(0, i - 30);
    problems.push(
      `Text differs after removing tags, near: plain="${a.slice(from, i + 40)}" tagged="${b.slice(from, i + 40)}"`,
    );
  }
  return { ok: problems.length === 0, problems };
}

export function splitWords(text: string): string[] {
  const t = normalizeWs(text);
  return t ? t.split(" ") : [];
}

export function countWords(text: string): number {
  return splitWords(text).length;
}

// Kırpılmış seslendirmede yaklaşık konuşma hızı (kelime/saniye).
const WORDS_PER_SECOND = 2.2;

export function estimateSeconds(wordCount: number): number {
  return Math.round(wordCount / WORDS_PER_SECOND);
}

export const LENGTH_TARGETS = {
  short: { minWords: 170, maxWords: 240, label: "60-90 sn" },
  long: { minWords: 300, maxWords: 330, label: "2-3 dk" },
} as const;
export type DurationChoice = keyof typeof LENGTH_TARGETS;
