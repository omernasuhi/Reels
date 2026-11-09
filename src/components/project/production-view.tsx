"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDict } from "@/i18n";
import { cn } from "@/lib/utils";
import { acceptFrame, retryFrame } from "@/server/actions/projects";
import type { ProjectState } from "@/server/state";
import { JobProgress, useAction } from "./shared";

const t = getDict();
const p = t.production;

type FrameState = ProjectState["frames"][number];

const WORKING = ["generating", "checking", "fixing"];

type TileProps = { frame: FrameState; selected?: boolean; onSelect?: () => void; compact?: boolean };

// compact: dar zaman çizelgesi kutusu; hazır karelerde durum yazısı gösterilmez.
export function FrameTile({ frame, selected, onSelect, compact }: TileProps) {
  const attention = frame.status === "error" || frame.status === "review";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative block aspect-[9/16] w-full overflow-hidden rounded-md border bg-muted text-left",
        selected ? "border-primary outline-2 outline-primary" : attention ? "border-destructive" : "border-border",
      )}
    >
      {frame.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame.image} alt={p.frameAlt(frame.index + 1, frame.sentence)} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className={cn("block h-full w-full", WORKING.includes(frame.status) && "animate-pulse bg-border")} />
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/75 px-1.5 py-1 text-[13px] font-medium text-white">
        <span className="tabular-nums">{frame.index + 1}</span>
        {compact && frame.status === "ready" ? null : (
          <span className={cn("truncate", attention && "text-[#ffb4a8]")}>{p.frameStatus[frame.status]}</span>
        )}
      </span>
    </button>
  );
}

export function ProductionView({ state, refresh }: { state: ProjectState; refresh: () => Promise<void> }) {
  const { run, pending, error } = useAction(refresh);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { frames, project, audioReady } = state;
  const done = frames.filter((f) => f.status === "ready" || f.status === "review").length;
  const partial = frames.reduce(
    (sum, f) => sum + (f.status === "ready" || f.status === "review" ? 1 : f.status === "checking" ? 0.8 : f.status === "fixing" ? 0.85 : f.status === "generating" ? 0.3 : 0),
    0,
  );
  const fraction = frames.length ? 0.9 * (partial / frames.length) + (audioReady ? 0.1 : 0.03) : 0;
  const attention = frames.filter((f) => f.status === "error" || f.status === "review");
  const working = frames.some((f) => f.status === "queued" || WORKING.includes(f.status)) || !audioReady;
  const selected = frames.find((f) => f.id === selectedId) ?? null;
  const label = !audioReady && project.job_step && project.job_step !== "frames" ? `${t.jobSteps.frames} · ${t.jobSteps[project.job_step as keyof typeof t.jobSteps] ?? ""}` : t.jobSteps.frames;

  return (
    <section aria-labelledby="production-title" className="space-y-6">
      <h2 id="production-title" className="text-2xl font-semibold tracking-tight">
        {p.title}
      </h2>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {working ? (
        <JobProgress
          label={label}
          fraction={fraction}
          startedAt={project.job_started_at}
          expectedSeconds={Math.max(120, frames.length * 12)}
          detail={`${p.framesProgress(done, frames.length)} · ${audioReady ? p.audioReady : p.audioPending}`}
        />
      ) : null}
      {attention.length ? <Alert tone="error">{p.needsAttention(attention.length)}</Alert> : null}

      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
        {frames.map((f) => (
          <li key={f.id}>
            <FrameTile frame={f} selected={f.id === selectedId} onSelect={() => setSelectedId(f.id === selectedId ? null : f.id)} />
          </li>
        ))}
      </ul>

      {selected ? (
        <div className="rounded-lg border border-border bg-card p-5" aria-live="polite">
          <p className="font-medium">
            {t.preview.frameN(selected.index + 1)} · {p.frameStatus[selected.status]}
          </p>
          <p className="mt-2">{selected.sentence}</p>
          {selected.status === "review" ? (
            <>
              <p className="mt-3">{p.reviewHelp}</p>
              {selected.qc_result ? (
                <p className="mt-1 font-medium">
                  {(["realistic_face", "stray_text", "wrong_character"] as const)
                    .filter((k) => selected.qc_result![k])
                    .map((k) => p.qc[k])
                    .join(", ")}
                </p>
              ) : null}
            </>
          ) : null}
          {selected.status === "review" || selected.status === "error" ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button disabled={Boolean(pending)} onClick={() => run("retry", () => retryFrame(selected.id))}>
                {p.retryFree}
              </Button>
              {selected.status === "review" ? (
                <Button variant="outline" disabled={Boolean(pending)} onClick={() => run("accept", () => acceptFrame(selected.id))}>
                  {p.accept}
                </Button>
              ) : null}
              <p className="self-center text-muted-foreground">{p.retryFreeHelp}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
