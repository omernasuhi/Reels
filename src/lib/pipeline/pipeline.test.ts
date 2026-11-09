import { describe, expect, it } from "vitest";
import { alignWords, charsToWords, findPhrase, type CharAlignment } from "./align";
import { stripTags, validateTagged, URGENCY_TAG } from "./tags";
import {
  buildFrameTimes,
  buildTrimMap,
  defaultCards,
  mapTime,
  parseSilences,
  trimFilter,
  trimmedDuration,
  upperTr,
} from "./timeline";

describe("etiket/metin eşleşmesi", () => {
  const plain = "Kapı açılıyo. İçeri giriyosun. Neden olmasın?";
  it("etiketler silinince metin birebir aynı kalır", () => {
    const tagged = "[low, steady voice] Kapı açılıyo. [pause] İçeri giriyosun.\n\n[curious] Neden olmasın?";
    expect(stripTags(tagged)).toBe(plain);
    expect(validateTagged(plain, tagged).ok).toBe(true);
  });
  it("değişen kelimeyi yakalar", () => {
    const r = validateTagged(plain, "[low, steady voice] Kapı açılıyor. İçeri giriyosun. Neden olmasın?");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("differs");
  });
  it("izinsiz etiketi ve fazla aciliyet etiketini yakalar", () => {
    expect(validateTagged(plain, `[whispers] ${plain}`).problems[0]).toContain("[whispers]");
    const many = Array(6).fill(`${URGENCY_TAG} a`).join(" ");
    expect(validateTagged(Array(6).fill("a").join(" "), many).ok).toBe(false);
  });
});

function fakeAlignment(text: string, perChar = 0.1): CharAlignment {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * perChar),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * perChar),
  };
}

describe("kelime hizalama", () => {
  it("karakterleri kelimelere çevirir ve etiketleri atar", () => {
    const words = charsToWords(fakeAlignment("[low, steady voice] Kapı açılıyo. [pause] Gir."));
    expect(words.map((w) => w.word)).toEqual(["Kapı", "açılıyo.", "Gir."]);
    expect(words[0].start).toBeCloseTo(2.0);
    expect(words[0].end).toBeCloseTo(2.4);
  });
  it("birebir eşleşmede zamanları aynen kullanır", () => {
    const spoken = charsToWords(fakeAlignment("Bir iki üç"));
    const r = alignWords("Bir iki üç", spoken);
    expect(r.exact).toBe(true);
    expect(r.words[2].start).toBeCloseTo(spoken[2].start);
  });
  it("eksik ve farklı yazılmış kelimelerde hizalar, boşlukları doldurur", () => {
    // Konuşulan: "on" yerine "10", "dört" hiç duyulmamış.
    const spoken = [
      { word: "bir", start: 0, end: 0.4 },
      { word: "iki", start: 0.5, end: 0.9 },
      { word: "10", start: 1.0, end: 1.4 },
      { word: "beş", start: 2.0, end: 2.4 },
    ];
    const r = alignWords("Bir, iki on dört beş", spoken);
    expect(r.exact).toBe(false);
    expect(r.words.map((w) => w.word)).toEqual(["Bir,", "iki", "on", "dört", "beş"]);
    expect(r.words[2].start).toBeCloseTo(1.0);
    expect(r.words[3].start).toBeCloseTo(1.4);
    expect(r.words[3].end).toBeCloseTo(2.0);
    expect(r.words[4].start).toBeCloseTo(2.0);
    expect(r.unmatched).toBe(1);
  });
  it("start_phrase'i imleçten sonra bulur", () => {
    const words = charsToWords(fakeAlignment("O gün geliyo. O gün bitiyo, sonra gidiyo."));
    expect(findPhrase(words, "O gün", 0)).toBe(0);
    expect(findPhrase(words, "O gün", 1)).toBe(3);
    expect(findPhrase(words, "sonra gidiyo", 0)).toBe(6);
  });
});

describe("trim_map zaman dönüşümü", () => {
  const stderr = [
    "[silencedetect @ 0x1] silence_start: 2",
    "[silencedetect @ 0x1] silence_end: 3 | silence_duration: 1",
    "[silencedetect @ 0x1] silence_start: 5",
    "[silencedetect @ 0x1] silence_end: 6.5 | silence_duration: 1.5",
    "[silencedetect @ 0x1] silence_start: 8",
    "[silencedetect @ 0x1] silence_end: 8.15 | silence_duration: 0.15",
  ].join("\n");
  const silences = parseSilences(stderr, 10);
  // 6.5'te korunan bir cümle başlıyor.
  const cuts = buildTrimMap(silences, [6.5]);

  it("sessizlikleri okur", () => {
    expect(silences).toEqual([
      { start: 2, end: 3 },
      { start: 5, end: 6.5 },
      { start: 8, end: 8.15 },
    ]);
  });
  it("0,2 sn bırakır; korunan boşlukta 0,55 sn bırakır; kısa boşluğa dokunmaz", () => {
    expect(cuts).toEqual([
      { start: 2.1, end: 2.9 },
      { start: 5.275, end: 6.225 },
    ]);
    expect(trimmedDuration(10, cuts)).toBeCloseTo(10 - 0.8 - 0.95);
  });
  it("ham zamanı kırpılmış zamana çevirir", () => {
    expect(mapTime(1, cuts)).toBeCloseTo(1);
    expect(mapTime(2.5, cuts)).toBeCloseTo(2.1); // kesilen aralığın içi başına yapışır
    expect(mapTime(3, cuts)).toBeCloseTo(2.2);
    expect(mapTime(6.5, cuts)).toBeCloseTo(6.5 - 0.8 - 0.95);
    expect(mapTime(10, cuts)).toBeCloseTo(8.25);
  });
  it("ffmpeg filtresini üretir", () => {
    expect(trimFilter(cuts)).toBe(
      "aselect='not(between(t,2.1,2.9)+between(t,5.275,6.225))',asetpts=N/SR/TB",
    );
    expect(trimFilter([])).toBeNull();
  });
  it("kare zamanlarını hesaplar: 0,12 sn önce, 30 fps, en az 0,8 sn, 1,2 sn kuyruk", () => {
    const words = [
      { word: "Kapı", start: 0.3, end: 0.6 },
      { word: "açılıyo.", start: 0.7, end: 1.9 },
      { word: "İçeri", start: 3.0, end: 3.4 },
      { word: "giriyosun.", start: 3.5, end: 4.9 },
      { word: "Hemen", start: 3.6, end: 3.9 },
      { word: "Birinci", start: 6.5, end: 7.0 },
      { word: "sorun:", start: 7.1, end: 7.9 },
    ];
    const r = buildFrameTimes(["Kapı açılıyo", "İçeri", "Hemen", "Birinci sorun"], words, cuts, 10);
    expect(r.missing).toEqual([]);
    expect(r.frames[0].start_time_final).toBe(0);
    // 3.0 - 0.12 = 2.88 ham -> kesilen aralıkta (2.1-2.9) -> 2.1 -> kareye yuvarla
    expect(r.frames[1].start_time_final).toBeCloseTo(2.1, 5);
    // 3.6 - 0.12 = 3.48 -> 2.68; ama önceki kareden en az 0,8 sn sonra
    expect(r.frames[2].start_time_final).toBeCloseTo(2.9, 5);
    // 6.5 - 0.12 = 6.38 -> 6.38 - 0.8 - 0.95 = 4.63 -> 30 fps
    expect(r.frames[3].start_time_final).toBeCloseTo(Math.round(4.63 * 30) / 30, 5);
    expect(r.total).toBeCloseTo(Math.round((8.25 + 1.2) * 30) / 30, 5);
    const sum = r.frames.reduce((s, f) => s + f.duration, 0);
    expect(sum).toBeCloseTo(r.total, 2);
  });
});

describe("kartlar", () => {
  it("Türkçe büyük harf dönüşümü", () => {
    expect(upperTr("istanbul ılık")).toBe("İSTANBUL ILIK");
  });
  it("varsayılan kartları üretir", () => {
    const cards = defaultCards(
      [
        { index: 0, kind: "opening", duration: 3 },
        { index: 1, kind: "problem", duration: 3 },
        { index: 2, kind: "problem", duration: 3 },
        { index: 3, kind: "closing", duration: 6 },
      ],
      "İstanbul, gece yarısı",
      ["kal", "git"],
    );
    expect(cards.map((c) => c.text)).toEqual([
      "İSTANBUL, GECE YARISI",
      "BİRİNCİ SORUN",
      "İKİNCİ SORUN",
      "KAL YA DA GİT",
    ]);
    expect(cards[1].duration).toBe(1.8);
  });
});
