// Açılışta ve sorun başlıklarında çalan kısa "tın": 1318 Hz sinüs, 0,6 sn,
// -9 dB, üstel sönümlü. Dosya gerektirmesin diye WAV olarak bellekte üretilir.
const SAMPLE_RATE = 44100;
const DURATION = 0.6;
const FREQ = 1318;
const GAIN = 10 ** (-9 / 20);

function buildWav(): Uint8Array {
  const n = Math.floor(SAMPLE_RATE * DURATION);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.005);
    const sample = Math.sin(2 * Math.PI * FREQ * t) * Math.exp(-7 * t) * attack * GAIN;
    v.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return new Uint8Array(buf);
}

let cached: string | null = null;

export function toneDataUrl(): string {
  if (cached) return cached;
  const bytes = buildWav();
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  cached = `data:audio/wav;base64,${btoa(bin)}`;
  return cached;
}

export const TONE_SECONDS = DURATION;
