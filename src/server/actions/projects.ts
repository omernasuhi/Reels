"use server";

import { redirect } from "next/navigation";
import { getDict } from "@/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveTitle } from "@/lib/text";
import { requireUser } from "@/server/auth";

export type NewProjectState = { error?: string; topic?: string };

export async function createProject(
  _prev: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const t = getDict().newProject;
  const user = await requireUser();
  const topic = String(formData.get("topic") ?? "").trim();

  if (topic.length < 10) return { error: t.errors.tooShort, topic };
  if (topic.length > 2000) return { error: t.errors.tooLong, topic };

  // Yazma işlemleri sunucuda service_role ile yapılır; sahiplik burada atanır.
  const { data, error } = await createAdminClient()
    .from("projects")
    .insert({ user_id: user.id, title: deriveTitle(topic), topic })
    .select("id")
    .single();

  if (error || !data) {
    console.error(JSON.stringify({ step: "project.create", user: user.id, error: error?.message }));
    return { error: t.errors.generic, topic };
  }
  redirect(`/projects/${data.id}`);
}
