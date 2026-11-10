"use client";

import Link from "next/link";
import { StepProgress } from "@/components/step-progress";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDict } from "@/i18n";
import { stepForStatus } from "@/lib/types";
import { requestScript } from "@/server/actions/projects";
import type { ProjectState } from "@/server/state";
import { AssistantPanel } from "./assistant-panel";
import { CharactersView } from "./characters-view";
import { PreviewView } from "./preview-view";
import { ProductionView } from "./production-view";
import { ScriptView } from "./script-view";
import { JobProgress, useAction, useProjectState } from "./shared";

const t = getDict();

function DraftView({ state, refresh }: { state: ProjectState; refresh: () => Promise<void> }) {
  const { run, pending, error } = useAction(refresh);
  return (
    <section className="space-y-6">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-medium">{t.project.topic}</h2>
        <p className="mt-2 whitespace-pre-wrap">{state.project.topic}</p>
      </div>
      <p>{t.project.draftHelp}</p>
      <Button size="lg" className="w-full" disabled={Boolean(pending)} onClick={() => run("script", () => requestScript(state.project.id))}>
        {pending ? t.common.working : t.project.writeScript(state.pricing.script)}
      </Button>
    </section>
  );
}

export function ProjectWorkspace({ initial }: { initial: ProjectState }) {
  const { state, refresh, failed } = useProjectState(initial);
  const { project } = state;
  const writing = project.job_step === "script";

  let view: React.ReactNode;
  if (writing) {
    view = <JobProgress label={t.jobSteps.script} startedAt={project.job_started_at} expectedSeconds={90} />;
  } else if (project.status === "draft" || (project.status === "script" && !state.script)) {
    view = <DraftView state={state} refresh={refresh} />;
  } else if (project.status === "script") {
    view = <ScriptView state={state} refresh={refresh} />;
  } else if (project.status === "characters") {
    view = <CharactersView state={state} refresh={refresh} />;
  } else if (project.status === "producing") {
    view = <ProductionView state={state} refresh={refresh} />;
  } else {
    view = <PreviewView state={state} refresh={refresh} />;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mx-auto max-w-2xl">
        <StepProgress current={stepForStatus(project.status)} />
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{project.title}</h1>
          <Badge>{t.projectStatus[project.status]}</Badge>
        </div>
      </div>

      <div className={project.status === "producing" ? "mt-8" : "mx-auto mt-8 max-w-2xl"}>
        {failed ? <Alert tone="error" className="mb-6">{t.project.loadError}</Alert> : null}
        {project.job_error && !writing && project.status !== "characters" ? (
          <Alert tone="error" className="mb-6">
            {project.job_error}
          </Alert>
        ) : null}
        {view}

        {project.status === "draft" ? null : <AssistantPanel projectId={project.id} refresh={refresh} />}

        {state.events ? (
          <details className="mt-12 rounded-lg border border-border">
            <summary className="cursor-pointer px-4 py-3 font-medium">
              {t.admin.events} ({state.events.length})
            </summary>
            {state.events.length ? (
              <ul className="divide-y divide-border border-t border-border text-[15px]">
                {state.events.map((e) => (
                  <li key={e.id} className="px-4 py-2">
                    <span className={e.level === "info" ? "font-medium" : "font-medium text-destructive"}>{e.step}</span> · {e.message}
                    <span className="block text-muted-foreground">
                      {new Date(e.created_at).toLocaleTimeString("tr-TR")}
                      {e.data ? ` · ${JSON.stringify(e.data).slice(0, 300)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-border px-4 py-3">{t.admin.noEvents}</p>
            )}
          </details>
        ) : null}

        <p className="mt-10">
          <Link href="/" className="underline underline-offset-4">
            {t.project.back}
          </Link>
        </p>
      </div>
    </div>
  );
}
