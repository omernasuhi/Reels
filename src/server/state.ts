import "server-only";
import { signedUrl } from "@/lib/storage";
import type { AudioRow, Card, Character, Frame, Project, Render, Script } from "@/lib/types";
import type { StoryProps } from "@/remotion/types";
import { db, getSetting, type Pricing } from "@/server/db";
import { buildStoryProps } from "@/server/pipeline/render";

export type ProjectEvent = { id: number; level: string; step: string; message: string; data: unknown; created_at: string };

// Proje sayfasının ihtiyaç duyduğu her şey; istemci bunu yoklayarak canlı günceller.
export type ProjectState = {
  project: Project;
  script: Pick<Script, "id" | "plain_text" | "word_count" | "version" | "approved_at"> | null;
  characters: (Pick<Character, "id" | "name" | "description_en" | "status" | "approved_at"> & { card_url: string | null })[];
  frames: (Pick<Frame, "id" | "index" | "sentence" | "status" | "kind" | "qc_result" | "start_time_final" | "duration"> & {
    image: string | null;
  })[];
  audioReady: boolean;
  cards: Card[];
  renders: (Pick<Render, "variant" | "status"> & { url: string | null })[];
  story: StoryProps | null;
  pricing: Pricing;
  balance: number;
  events: ProjectEvent[] | null;
};

export async function loadProjectState(projectId: string, userId: string, admin: boolean): Promise<ProjectState | null> {
  const { data: p } = await db().from("projects").select("*").eq("id", projectId).maybeSingle();
  const project = p as Project | null;
  if (!project || (project.user_id !== userId && !admin)) return null;

  const [script, chars, frames, audio, cards, renders, pricing, profile, events] = await Promise.all([
    db().from("scripts").select("id, plain_text, word_count, version, approved_at").eq("project_id", projectId).order("version", { ascending: false }).limit(1).maybeSingle(),
    db().from("characters").select("*").eq("project_id", projectId).order("created_at"),
    db().from("frames").select("*").eq("project_id", projectId).order("index"),
    db().from("audio").select("trimmed_url").eq("project_id", projectId).maybeSingle(),
    db().from("cards").select("*").eq("project_id", projectId).order("frame_index"),
    db().from("renders").select("*").eq("project_id", projectId),
    getSetting("pricing"),
    db().from("profiles").select("credits_balance").eq("id", userId).maybeSingle(),
    admin
      ? db().from("project_events").select("*").eq("project_id", projectId).order("id", { ascending: false }).limit(80)
      : Promise.resolve({ data: null }),
  ]);

  const showStory = ["preview", "rendering", "done"].includes(project.status);
  return {
    project,
    script: script.data as ProjectState["script"],
    characters: await Promise.all(
      ((chars.data ?? []) as Character[]).map(async (c) => ({
        id: c.id,
        name: c.name,
        description_en: c.description_en,
        status: c.status,
        approved_at: c.approved_at,
        card_url: await signedUrl(c.card_image_url),
      })),
    ),
    frames: await Promise.all(
      ((frames.data ?? []) as Frame[]).map(async (f) => ({
        id: f.id,
        index: f.index,
        sentence: f.sentence,
        status: f.status,
        kind: f.kind,
        qc_result: f.qc_result,
        start_time_final: f.start_time_final,
        duration: f.duration,
        image: await signedUrl(f.image_url),
      })),
    ),
    audioReady: Boolean((audio.data as Pick<AudioRow, "trimmed_url"> | null)?.trimmed_url),
    cards: (cards.data ?? []) as Card[],
    renders: await Promise.all(
      ((renders.data ?? []) as Render[]).map(async (r) => ({ variant: r.variant, status: r.status, url: await signedUrl(r.video_url, 6) })),
    ),
    story: showStory ? await buildStoryProps(projectId, true) : null,
    pricing,
    balance: (profile.data?.credits_balance as number) ?? 0,
    events: (events.data as ProjectEvent[] | null) ?? null,
  };
}
