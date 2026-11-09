"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDict } from "@/i18n";
import { StoryVideo } from "@/remotion/StoryVideo";
import { VIDEO, type StoryProps } from "@/remotion/types";
import { acceptFrame, exportVideo, regenerateFrame, retryFrame, updateCard } from "@/server/actions/projects";
import type { ProjectState } from "@/server/state";
import { FrameTile } from "./production-view";
import { JobProgress, useAction } from "./shared";

const t = getDict();
const v = t.preview;

type Props = { state: ProjectState; refresh: () => Promise<void> };

function CardRow({ card, run, pending }: { card: ProjectState["cards"][number]; run: ReturnType<typeof useAction>["run"]; pending: string | null }) {
  const [text, setText] = useState(card.text);
  const id = `card-${card.id}`;
  const dirty = text.trim() !== card.text && text.trim() !== "";
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
      <label htmlFor={id} className="sr-only">
        {v.cardText}
      </label>
      <Input id={id} value={text} maxLength={80} onChange={(e) => setText(e.target.value)} className="sm:flex-1" />
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={card.enabled}
            disabled={Boolean(pending)}
            onChange={(e) => run(`card-${card.id}`, () => updateCard(card.id, { enabled: e.target.checked }))}
            className="size-5 accent-primary"
          />
          {v.cardEnabled}
        </label>
        {dirty ? (
          <Button size="sm" variant="outline" disabled={Boolean(pending)} onClick={() => run(`card-${card.id}`, () => updateCard(card.id, { text }))}>
            {t.common.save}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function PreviewView({ state, refresh }: Props) {
  const { run, pending, error } = useAction(refresh);
  const player = useRef<PlayerRef>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCards, setShowCards] = useState(true);
  const { project, frames, cards, renders, pricing, story } = state;
  const rendering = project.status === "rendering";

  // Adresler saatlik imzalandığı için içerik değişmedikçe aynı kalır; oynatıcı gereksiz yere yeniden kurulmaz.
  const storyKey = JSON.stringify(story);
  const inputProps: StoryProps | null = useMemo(
    () => (story ? { ...(JSON.parse(storyKey) as StoryProps), showCards } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storyKey, showCards],
  );

  const selected = frames.find((f) => f.id === selectedId) ?? null;
  const selectFrame = (f: ProjectState["frames"][number]) => {
    setSelectedId(f.id);
    if (f.start_time_final !== null) {
      player.current?.pause();
      player.current?.seekTo(Math.round(f.start_time_final * VIDEO.fps) + 2);
    }
  };

  // Oynatırken zaman çizelgesindeki etkin kareyi takip et.
  const [playingIndex, setPlayingIndex] = useState(0);
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      const time = e.detail.frame / VIDEO.fps;
      let idx = 0;
      for (const f of frames) if ((f.start_time_final ?? 0) <= time) idx = f.index;
      setPlayingIndex(idx);
    };
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [frames, inputProps]);

  const busyFrame = frames.some((f) => !["ready", "review"].includes(f.status));
  const doneRenders = renders.filter((r) => r.status === "done" && r.url);
  const duration = story ? story.durationInFrames / VIDEO.fps : 60;

  return (
    <section aria-labelledby="preview-title" className="space-y-8">
      <h2 id="preview-title" className="text-2xl font-semibold tracking-tight">
        {v.title}
      </h2>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {inputProps ? (
        <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-lg border border-border bg-black">
          <Player
            ref={player}
            component={StoryVideo}
            inputProps={inputProps}
            durationInFrames={Math.max(1, inputProps.durationInFrames)}
            fps={VIDEO.fps}
            compositionWidth={VIDEO.width}
            compositionHeight={VIDEO.height}
            controls
            acknowledgeRemotionLicense
            style={{ width: "100%", aspectRatio: "9 / 16" }}
          />
        </div>
      ) : (
        <p>{v.playerLoading}</p>
      )}

      <label className="flex items-center gap-3">
        <input type="checkbox" checked={showCards} onChange={(e) => setShowCards(e.target.checked)} className="size-5 accent-primary" />
        {v.showCards}
      </label>

      <div>
        <h3 className="text-xl font-semibold">{v.timeline}</h3>
        <p className="mt-1 text-muted-foreground">{v.selectHint}</p>
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {frames.map((f) => (
            <li key={f.id} className="w-20 shrink-0">
              <FrameTile compact frame={f} selected={f.id === selectedId || (!selectedId && f.index === playingIndex)} onSelect={() => selectFrame(f)} />
            </li>
          ))}
        </ul>
      </div>

      {selected ? (
        <div className="rounded-lg border border-border bg-card p-5" aria-live="polite">
          <p className="font-medium">
            {v.frameN(selected.index + 1)} · {t.production.frameStatus[selected.status]}
          </p>
          <p className="mt-2 text-lg">{selected.sentence}</p>
          {selected.status === "review" ? <p className="mt-3">{t.production.reviewHelp}</p> : null}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {selected.status === "review" ? (
              <>
                <Button variant="outline" disabled={Boolean(pending) || rendering} onClick={() => run("retry", () => retryFrame(selected.id))}>
                  {t.production.retryFree}
                </Button>
                <Button variant="outline" disabled={Boolean(pending) || rendering} onClick={() => run("accept", () => acceptFrame(selected.id))}>
                  {t.production.accept}
                </Button>
              </>
            ) : null}
            {selected.status === "ready" || selected.status === "review" ? (
              <Button
                variant="outline"
                className="h-auto min-h-11 whitespace-normal py-2"
                disabled={Boolean(pending) || rendering}
                onClick={() => run("regen", () => regenerateFrame(selected.id))}
              >
                {v.regenerate(pricing.frame_regenerate)}
              </Button>
            ) : (
              <p>{v.regenerating}</p>
            )}
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="text-xl font-semibold">{v.cardsTitle}</h3>
        {cards.length ? (
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {cards.map((card) => (
              <CardRow key={`${card.id}-${card.text}`} card={card} run={run} pending={pending} />
            ))}
          </ul>
        ) : (
          <p className="mt-2">{v.noCards}</p>
        )}
      </div>

      {rendering ? (
        <JobProgress
          label={t.jobSteps[(project.job_step as "render_cards" | "render_clean") ?? "render_cards"] ?? t.jobSteps.render_cards}
          fraction={undefined}
          startedAt={project.job_started_at}
          expectedSeconds={Math.max(90, duration * 3)}
        />
      ) : (
        <div className="space-y-4">
          {doneRenders.length ? (
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="text-xl font-semibold">{v.downloads}</h3>
              <div className="mt-3 flex flex-col gap-2">
                {doneRenders.map((r) => (
                  <Button key={r.variant} asChild variant={r.variant === "cards" ? "default" : "outline"} size="lg">
                    <a href={r.url!} download={`${project.title}-${r.variant === "cards" ? "kartli" : "temiz"}.mp4`}>
                      {r.variant === "cards" ? v.downloadCards : v.downloadClean}
                    </a>
                  </Button>
                ))}
              </div>
              <p className="mt-3 text-muted-foreground">{v.stale}</p>
            </div>
          ) : null}
          <div>
            <p className="text-muted-foreground">{v.exportHelp}</p>
            <Button
              size="lg"
              variant={doneRenders.length ? "outline" : "default"}
              className="mt-2 h-auto min-h-12 w-full whitespace-normal py-3"
              disabled={Boolean(pending) || busyFrame || !story}
              onClick={() => run("export", () => exportVideo(project.id))}
            >
              {pending === "export" ? t.common.working : doneRenders.length ? v.exportAgain(pricing.render) : v.export(pricing.render)}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
