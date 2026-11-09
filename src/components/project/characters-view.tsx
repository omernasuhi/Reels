"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getDict } from "@/i18n";
import { approveCharacter, regenerateCharacter, retryFramePlan, startProduction } from "@/server/actions/projects";
import type { ProjectState } from "@/server/state";
import { JobProgress, useAction } from "./shared";

const t = getDict();
const c = t.characters;

type Props = { state: ProjectState; refresh: () => Promise<void> };
type Run = ReturnType<typeof useAction>["run"];

function CharacterCard({ character, credits, run, pending }: { character: ProjectState["characters"][number]; credits: number; run: Run; pending: string | null }) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(character.description_en);
  const generating = character.status === "generating" || character.status === "pending";
  const id = `desc-${character.id}`;

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="relative aspect-[9/16] overflow-hidden rounded-md bg-muted">
        {character.card_url && !generating ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={character.card_url} alt={c.cardAlt(character.name)} className="h-full w-full object-cover" />
        ) : (
          <div className={`flex h-full items-center justify-center p-3 text-center ${generating ? "animate-pulse" : ""}`}>
            <span>{generating ? c.generating : c.failed}</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{character.name}</h3>
        {character.approved_at ? <Badge className="border-primary">{c.approved}</Badge> : null}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <Label htmlFor={id}>{c.description}</Label>
          <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={6} className="min-h-32 text-[15px]" />
          <Button
            size="sm"
            variant="outline"
            className="h-auto min-h-9 w-full whitespace-normal py-2"
            disabled={Boolean(pending) || description.trim().length < 20}
            onClick={() => {
              setEditing(false);
              run(`regen-${character.id}`, () => regenerateCharacter(character.id, description));
            }}
          >
            {c.saveAndRegenerate(credits)}
          </Button>
          <Button size="sm" variant="ghost" className="w-full" onClick={() => setEditing(false)}>
            {t.common.cancel}
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-1 line-clamp-4 text-[15px] text-muted-foreground">{character.description_en}</p>
          {generating ? null : (
            <div className="mt-3 flex flex-col gap-2">
              {character.status === "ready" && !character.approved_at ? (
                <Button size="sm" disabled={Boolean(pending)} onClick={() => run(`approve-${character.id}`, () => approveCharacter(character.id))}>
                  {c.approve}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="h-auto min-h-9 whitespace-normal py-2"
                disabled={Boolean(pending)}
                onClick={() => run(`regen-${character.id}`, () => regenerateCharacter(character.id))}
              >
                {character.status === "error" ? c.retry(credits) : c.regenerate(credits)}
              </Button>
              <Button size="sm" variant="ghost" disabled={Boolean(pending)} onClick={() => setEditing(true)}>
                {c.edit}
              </Button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

export function CharactersView({ state, refresh }: Props) {
  const { run, pending, error } = useAction(refresh);
  const { project, characters, frames, pricing } = state;
  const planning = project.job_step === "prepare";
  const planReady = frames.length > 0 && !planning;
  const allApproved = characters.length > 0 && characters.every((ch) => ch.status === "ready" && ch.approved_at);
  const total = frames.length * pricing.frame + pricing.voiceover;

  return (
    <section aria-labelledby="characters-title" className="space-y-6">
      <div>
        <h2 id="characters-title" className="text-2xl font-semibold tracking-tight">
          {c.title}
        </h2>
        <p className="mt-2 text-muted-foreground">{c.help}</p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {characters.map((ch) => (
          <CharacterCard key={ch.id} character={ch} credits={pricing.character_card} run={run} pending={pending} />
        ))}
      </ul>

      {planning ? (
        <JobProgress label={t.jobSteps.prepare} startedAt={project.job_started_at} expectedSeconds={120} />
      ) : !planReady ? (
        <Alert tone="error">
          <p>{project.job_error ?? c.planFailed}</p>
          <Button size="sm" variant="outline" className="mt-3" disabled={Boolean(pending)} onClick={() => run("plan", () => retryFramePlan(project.id))}>
            {c.retryPlan}
          </Button>
        </Alert>
      ) : (
        <div className="space-y-2">
          {allApproved ? null : <p>{c.needApproval}</p>}
          <Button
            size="lg"
            className="h-auto min-h-12 w-full whitespace-normal py-3"
            disabled={!allApproved || Boolean(pending)}
            onClick={() => run("start", () => startProduction(project.id))}
          >
            {pending === "start" ? t.common.working : c.start(frames.length, total)}
          </Button>
        </div>
      )}
    </section>
  );
}
