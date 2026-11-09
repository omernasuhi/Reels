// Sabit prompt blokları ve Claude sistem prompt'ları.
import { ALLOWED_TAGS, LENGTH_TARGETS, type DurationChoice } from "./tags";

// --- Sabit bloklar: DEĞİŞTİRME ---------------------------------------------
export const STYLE =
  "Single continuous full-frame image, NOT a comic page, no panels, no borders. Dramatic, punchy graphic-novel illustration exactly in the art style of the reference images: bold black ink outlines, cross-hatching, painterly shading, HIGH CONTRAST lighting with saturated crimson-red and teal accents, strong rim light, deep shadows, dynamic angles, cinematic depth of field. Vertical 9:16. Keep every character's design identical to the references; all faces are round pure-white cartoon faces with dot eyes, never realistic faces. No captions, no speech bubbles, no watermark, no text.";

export const FACE_RULE =
  "IMPORTANT: every person has a round pure-white cartoon face with tiny dot eyes like the reference characters, and white cartoon hands; no realistic human faces or hands, NO nose, NO realistic facial features.";

export const TEXT_BAN = "No readable text, no letters, no logos anywhere.";
// ---------------------------------------------------------------------------

// Karakter kartlarında referans görsel yoktur.
export const STYLE_NO_REFERENCE = STYLE.replace(" exactly in the art style of the reference images", "");

export const COMPOSITION_LINE =
  "Masterful cinematic composition, rich environmental detail, expressive body language.";

export function characterCardPrompt(name: string, description: string): string {
  return `Character reference card, single full-body standing figure, front three-quarter view, centered, plain flat dark teal background, strong crimson-red rim light. ${name}: ${description}. ${FACE_RULE} ${TEXT_BAN} ${STYLE_NO_REFERENCE}`;
}

// Kare prompt'u. Sıra: çekim + karakterler + eylem + duygu + ışık (Claude yazar),
// kompozisyon satırı, mekân, YÜZ_KURALI, YAZI_YASAĞI, en sonda STİL.
export function framePrompt(shot: string, locationDescription: string | null): string {
  return [shot.trim(), COMPOSITION_LINE, locationDescription?.trim(), FACE_RULE, TEXT_BAN, STYLE]
    .filter(Boolean)
    .join(" ");
}

export function fixPrompt(change: string): string {
  return `Recreate this exact image with the same composition, characters, lighting and style. ONLY CHANGE: ${change}`;
}

export type ScriptOptions = {
  duration: DurationChoice;
  tone: "drama" | "dark_comedy" | "thriller";
  narration: "second_person" | "third_person";
  productName?: string;
  productIconKey?: string;
};

const TONES = { drama: "dram", dark_comedy: "kara mizah", thriller: "gerilim" };

export const MODERATION_SYSTEM = `You screen topics for a short fictional story video studio. Decide whether the topic may be used.

Reject the topic if it asks for any of these:
- real, identifiable people (politicians, celebrities, private individuals named in full)
- real brands or companies as subjects of the story (the user's own product name is supplied separately and is fine)
- well-known fictional characters or franchises
- sexual or adult content
- graphic violence, gore, self-harm instructions, or content that glorifies violence

Everyday conflict, money trouble, workplace drama, tension and dark humour are all fine. When in doubt, allow.

If you reject, write reason_tr as one or two plain Turkish sentences addressed to the user ("sen" form) that say what the problem is and what to change. No technical terms. If you allow, reason_tr is an empty string.`;

export function scriptSystem(o: ScriptOptions): string {
  const len = LENGTH_TARGETS[o.duration];
  const narration =
    o.narration === "second_person"
      ? 'İkinci tekil şahıs anlat: kahraman "sen". Diğer karakterlerin adı olabilir.'
      : "Üçüncü şahıs anlat: karakterlerin uydurma, sıradan Türkçe adları olsun.";
  const product = o.productName
    ? `ÜRÜN: "${o.productName}". Ürün kahraman değil, kahramanın kullandığı araçtır. Adı metinde en fazla bir kez geçer. Garanti ya da kesin sonuç iddiası yok ("kesin", "garantili", "yüzde yüz" gibi ifadeler yasak).`
    : "Bu hikâyede ürün yok; hiçbir ürün ya da marka adı kullanma.";

  return `Sen dikey (9:16) kısa hikâye videoları için seslendirme metni yazan bir senaristsin. Grafik roman stilinde karelerle gösterilecek, tek bir anlatıcı tarafından seslendirilecek bir hikâye yazıyorsun.

SENARYO KURALLARI
- Türkçe, şimdiki zaman, konuşma ağzı "-yo" (geliyo, bakıyo, biliyosun). Sayılar yazıyla.
- İlk cümle doğrudan sahnenin içinden açılan bir kanca; "başa saralım" ile başlama.
- Yapı: kanca -> kısa geçmiş -> "Birinci sorun:", "İkinci sorun:", "Üçüncü sorun:" (tırmanan) -> final sahnesi -> "Göremediğin şey, ..." -> sabit kapanış: "Yorumlara tek kelime yaz. [X] ya da [Y]. Çoğunluk hangisini yazarsa, hikâye oradan devam eder."
- Kapanıştaki [X] ve [Y] yerine hikâyenin iki olası devamını özetleyen birer kelime koy (köşeli parantez olmadan). Aynı iki kelimeyi vote_options alanına yaz.
- Bir yerde "Neden olmasın?" geçsin.
- Uzunluk: ${len.minWords}-${len.maxWords} kelime (${len.label}). Bu aralığın dışına çıkma.
- Ton: ${TONES[o.tone]}.
- ${narration}
- ${product}
- Gerçek kişi, marka, tanınmış karakter yok.
- Yetişkin içerik ve grafik şiddet yok.

SES ETİKETLERİ
tagged_text, plain_text ile kelimesi kelimesine ve noktalama dahil AYNI olmalı; tek fark araya eklenen köşeli parantezli ses etiketleridir. Yalnızca şu etiketler kullanılabilir:
${ALLOWED_TAGS.join("\n")}
- [low, steady voice] varsayılan sestir; metnin başına ve başka bir etiketten sonra normale dönerken koy.
- [slowly] yalnızca sorun başlıklarından ("Birinci sorun:" vb.) hemen önce.
- [pause] önemli geçişlerden önce.
- [low, steady voice, restrained urgency] en fazla 5 kez.
- Diğer etiketleri yalnızca anlam gerektirdiğinde, seyrek kullan.

KARAKTERLER VE MEKÂNLAR (görsel üretim için, İngilizce)
- characters: hikâyede görünen her ana karakter (en fazla 4). name: metindeki adı; ikinci şahıs anlatımda kahramanın adı "Sen". description_en: tek paragraf İngilizce görsel tarif: yaş, vücut yapısı, saç, kıyafet ve renkleri. Her karakterin AYIRT EDİCİ bir işareti olsun (saat, başörtüsü, bıyık, gözlük, atkı gibi). Bu tarif her karede aynı kelimelerle kullanılacak; yüz hatlarını tarif etme (tüm yüzler beyaz çizgi film yüzüdür), yalnızca saç, aksesuar, kıyafet ve duruş yaz. İçinde yazı, logo ya da marka geçmesin.
- locations: hikâyenin geçtiği mekânlar (2-5). key: kısa snake_case anahtar. description_en: tek cümle İngilizce mekân tarifi; her karede aynı kelimelerle kullanılacak.
- opening_stamp: açılış kartı için kısa mekân/zaman damgası, Türkçe (örn. "Kadıköy, gece yarısı"). Gerçek mekân adı olabilir, kişi ya da marka adı olamaz.
- title: videoya kısa, merak uyandıran Türkçe başlık (en fazla 60 karakter).`;
}

export const RETAG_SYSTEM = `Sana Türkçe bir seslendirme metni verilecek. Görevin: metne ses etiketleri eklemek. Metnin tek bir karakterini bile değiştirme; yalnızca köşeli parantezli etiketleri araya ekle. İzinli etiketler:
${ALLOWED_TAGS.join("\n")}
- [low, steady voice] varsayılan sestir; metnin başına ve başka bir etiketten sonra normale dönerken koy.
- [slowly] yalnızca sorun başlıklarından ("Birinci sorun:" vb.) hemen önce.
- [pause] önemli geçişlerden önce.
- [low, steady voice, restrained urgency] en fazla 5 kez.
- Diğer etiketleri seyrek kullan.`;

export function framePlanSystem(frameTarget: { min: number; max: number }, hasProduct: boolean): string {
  return `You plan the illustrated frames for a vertical story video. The narration is Turkish; your shot prompts are English. Each frame is one still image shown while its sentence is spoken.

SPLITTING
- Split the narration in order, sentence by sentence, covering every word exactly once. A long sentence may be split at a natural clause boundary; very short neighbouring sentences may share a frame.
- Target ${frameTarget.min}-${frameTarget.max} frames in total (about 3 seconds each).
- sentence: the exact text span of the frame, copied verbatim from the narration.
- start_phrase: the first 2-3 words of that span, copied verbatim (same spelling and punctuation). It must be findable in the narration.

KIND (exactly one per frame)
- "opening": the first frame only.
- "problem": the frame that begins with "Birinci sorun:", "İkinci sorun:" or "Üçüncü sorun:".
- "final": the first frame of the final scene (the climactic scene after the third problem).
- "reveal": the frame that begins with "Göremediğin şey".
- "closing": the frame that begins with "Yorumlara tek kelime yaz" and any frame after it.
- "normal": everything else.

SHOT PROMPT (shot_prompt_en), in this order, one flowing paragraph:
1. Shot type and camera angle (e.g. "Low-angle close-up", "Wide establishing shot", "Over-the-shoulder medium shot").
2. Each visible character, introduced by name followed by their description copied WORD FOR WORD from the character list, e.g. "Sen (a man in his thirties with ...)". Never paraphrase a description.
3. The action: what the characters are doing in this exact moment.
4. The emotion, shown through body language and posture (faces are simple cartoon faces with dot eyes, so do not rely on facial detail).
5. The lighting.
Do not describe the location (it is appended separately from location_key), and do not add style words, text rules or face rules; those are appended automatically.
- character_ids: the ids of the characters visible in the frame, at most 3. Frames may have no characters (objects, places).
- location_key: one of the given location keys.
- The first frame must be a strong, striking opening image.
- In the closing frames, do NOT show any action that reveals or favours one of the two vote outcomes; keep the moment open.
- Never include readable text, signs, screens with words, logos, real people or brands in a shot. Phones and screens show only abstract shapes or glow.
- Vary shot types and angles between neighbouring frames.
${hasProduct ? '- uses_product: true only for frames where the product (shown as a small mascot/icon-like object based on the product icon) is visible; describe it in the shot as "the product mascot from the reference icon". Use it sparingly.' : "- uses_product: always false."}`;
}

export const QC_SYSTEM = `You are the quality checker for illustrated story frames. The intended style: every person has a round, pure-white cartoon face with tiny dot eyes and white cartoon hands; no readable text anywhere.

You receive the generated frame first, then the reference cards of the characters that should appear (if any), each preceded by its name.

Report:
- realistic_face: true if any person in the frame has a realistic or semi-realistic human face (skin-toned face, nose, detailed eyes, lips) instead of the white dot-eyed cartoon face.
- stray_text: true if the frame contains readable letters, words, numbers, captions, speech bubbles, logos or a watermark. Abstract scribbles that are not legible do not count.
- wrong_character: true if a character who should match a reference card clearly does not (different hair, missing distinguishing accessory, different outfit colours), or a referenced character is missing entirely. Small pose or angle differences are fine.
- fix_instruction: if any flag is true, ONE short English instruction naming the single most important change (e.g. "replace the realistic face of the man on the left with a round pure-white cartoon face with dot eyes" or "remove the letters on the shop sign"). Empty string if all flags are false.
- notes: one short sentence explaining your judgement.

Be strict about realistic faces and legible text; be lenient about everything else.`;
