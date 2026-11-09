"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getDict } from "@/i18n";
import { countWords, estimateSeconds, LENGTH_TARGETS } from "@/lib/pipeline/tags";
import { approveScript, requestScript } from "@/server/actions/projects";
import type { ProjectState } from "@/server/state";
import { useAction } from "./shared";

const t = getDict();
const s = t.script;

export function ScriptView({ state, refresh }: { state: ProjectState; refresh: () => Promise<void> }) {
  const script = state.script!;
  // Yeni sürüm geldiğinde (yeniden yazım) metin kutusu sıfırlanır: key ile yeniden kurulur.
  return <Editor key={script.id} state={state} refresh={refresh} />;
}

function Editor({ state, refresh }: { state: ProjectState; refresh: () => Promise<void> }) {
  const script = state.script!;
  const [text, setText] = useState(script.plain_text);
  const { run, pending, error } = useAction(refresh);
  const words = countWords(text);
  const target = LENGTH_TARGETS[state.project.options.duration === "short" ? "short" : "long"];
  const outOfRange = words < target.minWords || words > target.maxWords;
  const dirty = text.trim() !== script.plain_text.trim();
  const cards = state.characters.length;
  const { pricing } = state;

  return (
    <section aria-labelledby="script-title" className="space-y-6">
      <div>
        <h2 id="script-title" className="text-2xl font-semibold tracking-tight">
          {s.title}
        </h2>
        <p className="mt-2 text-muted-foreground">{s.help}</p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="script-text">{s.textLabel}</Label>
        <Textarea
          id="script-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          className="min-h-80 leading-relaxed"
          aria-describedby="script-count"
        />
        <p id="script-count" className="font-medium" aria-live="polite">
          {s.words(words)} · {s.estimate(estimateSeconds(words))}
          <span className="font-normal text-muted-foreground"> · {s.target(target.minWords, target.maxWords)}</span>
        </p>
        {outOfRange ? <p>{s.outOfRange}</p> : null}
      </div>

      <div>
        <p className="font-medium">{s.rewriteTitle}</p>
        <p className="text-muted-foreground">
          {s.rewriteCost(pricing.script)}
          {dirty ? ` ${s.unsavedRewrite}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(s.rewrites).map(([key, r]) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(pending)}
              onClick={() => run(key, () => requestScript(state.project.id, r.instruction))}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      <Button
        size="lg"
        className="h-auto min-h-12 w-full whitespace-normal py-3"
        disabled={Boolean(pending) || !text.trim()}
        onClick={() => run("approve", () => approveScript(state.project.id, text))}
      >
        {pending === "approve" ? t.common.working : s.approve(cards, cards * pricing.character_card)}
      </Button>
    </section>
  );
}
