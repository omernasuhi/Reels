import type { Metadata } from "next";
import { StepProgress } from "@/components/step-progress";
import { TopicForm } from "@/components/topic-form";
import { getDict } from "@/i18n";
import { getSetting } from "@/server/db";

const t = getDict();
export const metadata: Metadata = { title: t.newProject.title };

export default async function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  const { topic } = await searchParams;
  const pricing = await getSetting("pricing");
  return (
    <div className="mx-auto max-w-2xl">
      <StepProgress current={1} />
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">{t.newProject.title}</h1>
      <div className="mt-6">
        <TopicForm initialTopic={typeof topic === "string" ? topic.slice(0, 2000) : ""} scriptCredits={pricing.script} />
      </div>
    </div>
  );
}
