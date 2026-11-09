import type { FrameKind } from "@/lib/pipeline/timeline";
import type { ScriptOptions } from "@/lib/pipeline/prompts";

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
  options: Partial<ScriptOptions>;
  status: ProjectStatus;
  cover_image_url: string | null;
  job_step: string | null;
  job_error: string | null;
  job_started_at: string | null;
  created_at: string;
};

export type Script = {
  id: string;
  project_id: string;
  plain_text: string;
  tagged_text: string;
  word_count: number;
  version: number;
  vote_options: string[] | null;
  opening_stamp: string | null;
  approved_at: string | null;
};

export type Character = {
  id: string;
  project_id: string;
  name: string;
  description_en: string;
  card_image_url: string | null;
  replicate_prediction_id: string | null;
  status: "pending" | "generating" | "ready" | "error";
  approved_at: string | null;
  created_at: string;
};

export type Location = { id: string; project_id: string; key: string; description_en: string };

export const FRAME_STATUSES = ["queued", "generating", "checking", "fixing", "ready", "review", "error"] as const;
export type FrameStatus = (typeof FRAME_STATUSES)[number];

export type QcResult = {
  realistic_face: boolean;
  stray_text: boolean;
  wrong_character: boolean;
  fix_instruction: string;
  notes: string;
};

export type Frame = {
  id: string;
  project_id: string;
  index: number;
  sentence: string;
  start_phrase: string;
  shot_prompt_en: string;
  character_ids: string[];
  location_key: string | null;
  kind: FrameKind;
  uses_product: boolean;
  image_url: string | null;
  status: FrameStatus;
  qc_result: QcResult | null;
  attempt_count: number;
  start_time_raw: number | null;
  start_time_final: number | null;
  duration: number | null;
};

export type AudioRow = {
  project_id: string;
  raw_url: string | null;
  trimmed_url: string | null;
  raw_duration: number | null;
  trimmed_duration: number | null;
  words: { word: string; start: number; end: number }[] | null;
  trim_map: { start: number; end: number }[] | null;
};

export type Card = {
  id: string;
  project_id: string;
  text: string;
  frame_index: number;
  offset: number;
  duration: number;
  size: number;
  y_position: number;
  enabled: boolean;
};

export type Render = {
  id: string;
  project_id: string;
  variant: "cards" | "clean";
  status: "queued" | "rendering" | "done" | "error";
  video_url: string | null;
  duration: number | null;
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
