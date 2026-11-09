// Kompozisyon girdisi: tarayıcı önizlemesi ve sunucu render'ı aynı veriyi kullanır.
export type StoryFrame = {
  url: string | null;
  start: number; // saniye
  duration: number; // saniye
  kind: "normal" | "opening" | "problem" | "final" | "reveal" | "closing";
  alt?: string;
};

export type StoryCard = {
  text: string;
  start: number; // saniye (mutlak)
  duration: number;
  size: number; // px, 1080 genişliğe göre
  y: number; // 0-1, dikey merkez
};

export type StoryProps = {
  frames: StoryFrame[];
  audioUrl: string | null;
  cards: StoryCard[];
  showCards: boolean;
  durationInFrames: number;
};

export const VIDEO = { width: 1080, height: 1920, fps: 30 } as const;
