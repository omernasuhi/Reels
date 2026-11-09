export const PROJECT_STATUSES = [
  "draft",
  "script",
  "characters",
  "producing",
  "preview",
  "rendering",
  "done",
  "failed",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Project = {
  id: string;
  user_id: string;
  title: string;
  topic: string;
  options: Record<string, unknown>;
  status: ProjectStatus;
  cover_image_url: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  credits_balance: number;
  is_admin: boolean;
  locale: string;
  default_voice_id: string | null;
  notify_email: boolean;
};

export type CreditTransaction = {
  id: string;
  amount: number;
  kind: "purchase" | "bonus" | "reserve" | "refund" | "adjust";
  reason: string;
  created_at: string;
};

// Proje durumunun sihirbazdaki adım karşılığı (1-5).
export function stepForStatus(status: ProjectStatus): number {
  switch (status) {
    case "draft":
      return 1;
    case "script":
      return 2;
    case "characters":
      return 3;
    case "producing":
      return 4;
    default:
      return 5;
  }
}
