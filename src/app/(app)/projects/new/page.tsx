import type { Metadata } from "next";
import { StepProgress } from "@/components/step-progress";
import { TopicForm } from "@/components/topic-form";
import { getDict } from "@/i18n";
import { requireUser } from "@/server/auth";
import { db, getSetting } from "@/server/db";

const t = getDict();
export const metadata: Metadata = { title: t.newProject.title };

export default async function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  const { topic } = await searchParams;
  const user = await requireUser();
  const pricing = await getSetting("pricing");
  const { data: ruleFiles } = await db().from("rule_files").select("id, name").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
  return (
    <div className="mx-auto max-w-2xl">
      <StepProgress current={1} />
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">{t.newProject.title}</h1>
      <div className="mt-6">
        <TopicForm initialTopic={typeof topic === "string" ? topic.slice(0, 2000) : ""} scriptCredits={pricing.script} ruleFiles={ruleFiles ?? []} />
      </div>
    </div>
  );
}
