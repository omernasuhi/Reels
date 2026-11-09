// Kelime zamanlamaları: ElevenLabs karakter hizalamasını kelimelere çevirir ve
// plain_text kelimeleriyle eşleştirir.
import { splitWords } from "./tags";

export type TimedWord = { word: string; start: number; end: number };

export type CharAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

// Karakter dizisinden kelimeleri çıkarır; [etiket] içindeki karakterleri atar.
export function charsToWords(a: CharAlignment): TimedWord[] {
  const out: TimedWord[] = [];
  let cur = "";
  let start = 0;
  let end = 0;
  let depth = 0;
  const flush = () => {
    if (cur) out.push({ word: cur, start, end });
    cur = "";
  };
  for (let i = 0; i < a.characters.length; i++) {
    // Bir "karakter" birden çok harf içerebilir; tek tek işle.
    for (const ch of a.characters[i]) {
      if (ch === "[") {
        flush();
        depth++;
      } else if (ch === "]") {
        depth = Math.max(0, depth - 1);
      } else if (depth > 0) {
        continue;
      } else if (/\s/.test(ch)) {
        flush();
      } else {
        if (!cur) start = a.character_start_times_seconds[i];
        cur += ch;
        end = a.character_end_times_seconds[i];
      }
    }
  }
  flush();
  return out;
}

export function normalizeWord(w: string): string {
  return w
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export type AlignResult = { words: TimedWord[]; exact: boolean; unmatched: number };

// plain kelimelerini konuşulan kelimelerle eşleştirir. Diziler birebir aynıysa
// doğrudan kullanır; değilse dinamik programlamayla hizalar ve eşleşmeyen
// kelimelerin zamanını komşularından ara değerle doldurur.
export function alignWords(plainText: string, spoken: TimedWord[]): AlignResult {
  const plain = splitWords(plainText);
  const pn = plain.map(normalizeWord);
  const sn = spoken.map((s) => normalizeWord(s.word));

  if (pn.length === sn.length && pn.every((w, i) => w === sn[i])) {
    return {
      words: plain.map((word, i) => ({ word, start: spoken[i].start, end: spoken[i].end })),
      exact: true,
      unmatched: 0,
    };
  }

  // Needleman-Wunsch: eşleşme +2, uyuşmazlık -1, boşluk -1.
  const n = pn.length;
  const m = sn.length;
  const w = m + 1;
  const score = new Int32Array((n + 1) * w);
  for (let i = 1; i <= n; i++) score[i * w] = -i;
  for (let j = 1; j <= m; j++) score[j] = -j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = score[(i - 1) * w + j - 1] + (pn[i - 1] === sn[j - 1] ? 2 : -1);
      const up = score[(i - 1) * w + j] - 1;
      const left = score[i * w + j - 1] - 1;
      score[i * w + j] = Math.max(diag, up, left);
    }
  }
  const matched: (number | null)[] = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const s = score[i * w + j];
    const same = pn[i - 1] === sn[j - 1];
    if (same && s === score[(i - 1) * w + j - 1] + 2) {
      matched[i - 1] = j - 1;
      i--;
      j--;
    } else if (s === score[(i - 1) * w + j] - 1) {
      i--;
    } else if (!same && s === score[(i - 1) * w + j - 1] - 1) {
      // Aynı konumdaki farklı yazım büyük olasılıkla aynı kelime ("on" / "10").
      matched[i - 1] = j - 1;
      i--;
      j--;
    } else {
      j--;
    }
  }

  const words: TimedWord[] = plain.map((word, k) => {
    const idx = matched[k];
    return idx === null
      ? { word, start: NaN, end: NaN }
      : { word, start: spoken[idx].start, end: spoken[idx].end };
  });

  // Eşleşmeyenleri komşu zamanlar arasında eşit böl.
  const total = spoken.length ? spoken[spoken.length - 1].end : 0;
  let unmatched = 0;
  for (let k = 0; k < words.length; k++) {
    if (!Number.isNaN(words[k].start)) continue;
    let e = k;
    while (e < words.length && Number.isNaN(words[e].start)) e++;
    const from = k > 0 ? words[k - 1].end : 0;
    const to = e < words.length ? words[e].start : total;
    const slot = (to - from) / (e - k);
    for (let x = k; x < e; x++) {
      words[x].start = from + slot * (x - k);
      words[x].end = from + slot * (x - k + 1);
      unmatched++;
    }
    k = e - 1;
  }
  return { words, exact: false, unmatched };
}

// start_phrase'in metindeki konumunu (ilk kelimenin indeksi) cursor'dan başlayarak bulur.
export function findPhrase(words: TimedWord[], phrase: string, cursor: number): number {
  const target = splitWords(phrase).map(normalizeWord).filter(Boolean);
  if (!target.length) return -1;
  const norm = words.map((x) => normalizeWord(x.word));
  for (let len = target.length; len >= 1; len--) {
    for (let i = cursor; i + len <= norm.length; i++) {
      let ok = true;
      for (let k = 0; k < len; k++) {
        if (norm[i + k] !== target[k]) {
          ok = false;
          break;
        }
      }
      if (ok) return i;
    }
  }
  return -1;
}
