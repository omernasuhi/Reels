// Konudan kısa bir proje başlığı türetir (senaryo yazılınca gerçek başlıkla değişir).
export function deriveTitle(topic: string, max = 60): string {
  const clean = topic.replace(/\s+/g, " ").trim();
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const base = firstSentence.replace(/[.!?]+$/, "");
  if (base.length <= max) return base;
  const cut = base.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}
