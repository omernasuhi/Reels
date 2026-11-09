import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/project/workspace";
import { isAdmin, requireUser } from "@/server/auth";
import { loadProjectState } from "@/server/state";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const state = await loadProjectState(id, user.id, await isAdmin());
  if (!state) notFound();
  return <ProjectWorkspace initial={state} />;
}
