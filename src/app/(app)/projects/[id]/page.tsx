import Link from "next/link";
import { notFound } from "next/navigation";
import { StepProgress } from "@/components/step-progress";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getDict } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import { stepForStatus, type Project } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const t = getDict();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, title, topic, status, created_at")
    .eq("id", id)
    .maybeSingle();
  const project = data as Pick<Project, "id" | "title" | "topic" | "status" | "created_at"> | null;
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <StepProgress current={stepForStatus(project.status)} />
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{project.title}</h1>
        <Badge>{t.projectStatus[project.status]}</Badge>
      </div>
      <p className="mt-2 text-muted-foreground">
        {t.project.created}: {formatDate(project.created_at)}
      </p>

      <Card className="mt-8 p-5">
        <h2 className="font-medium">{t.project.topic}</h2>
        <p className="mt-2 whitespace-pre-wrap">{project.topic}</p>
      </Card>

      <Alert className="mt-6">{t.project.scriptNotReady}</Alert>

      <p className="mt-8">
        <Link href="/" className="underline underline-offset-4">
          {t.project.back}
        </Link>
      </p>
    </div>
  );
}
