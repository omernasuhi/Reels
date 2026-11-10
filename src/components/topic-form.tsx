"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getDict } from "@/i18n";
import { createProject, type NewProjectState } from "@/server/actions/projects";

const t = getDict();
const n = t.newProject;

function Choice({ name, legend, options, defaultValue }: { name: string; legend: string; options: Record<string, string>; defaultValue: string }) {
  return (
    <fieldset>
      <legend className="font-medium">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(options).map(([value, label]) => (
          <label
            key={value}
            className="cursor-pointer rounded-md border border-border bg-card px-3.5 py-2 text-[15px] has-[:checked]:border-primary has-[:checked]:font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
          >
            <input type="radio" name={name} value={value} defaultChecked={value === defaultValue} className="sr-only" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type Props = { initialTopic: string; scriptCredits: number; ruleFiles: { id: string; name: string }[] };

export function TopicForm({ initialTopic, scriptCredits, ruleFiles }: Props) {
  const [state, action, pending] = useActionState<NewProjectState, FormData>(createProject, {});
  const [topic, setTopic] = useState(initialTopic);

  return (
    <form action={action} className="space-y-8">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="topic">{n.topicLabel}</Label>
        <p id="topic-help" className="text-muted-foreground">
          {n.topicHelp}
        </p>
        <Textarea
          id="topic"
          name="topic"
          required
          minLength={10}
          maxLength={2000}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={n.topicPlaceholder}
          aria-describedby="topic-help"
        />
      </div>

      {topic.trim() === "" ? (
        <div>
          <p className="font-medium">{n.examples}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {t.exampleTopics.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => setTopic(example)}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-left text-[15px] hover:border-primary"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 font-medium">{n.optional}</summary>
        <div className="space-y-6 border-t border-border px-4 py-5">
          <Choice name="duration" legend={n.duration} options={n.durations} defaultValue="long" />
          <Choice name="tone" legend={n.tone} options={n.tones} defaultValue="drama" />
          <Choice name="narration" legend={n.narration} options={n.narrations} defaultValue="second_person" />
          <div className="space-y-2">
            <Label htmlFor="productName">{n.productName}</Label>
            <p id="product-help" className="text-muted-foreground">
              {n.productHelp}
            </p>
            <Input id="productName" name="productName" maxLength={60} autoComplete="off" aria-describedby="product-help" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="productIcon">{n.productIcon}</Label>
            <p id="icon-help" className="text-muted-foreground">
              {n.productIconHelp}
            </p>
            <input
              id="productIcon"
              name="productIcon"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-describedby="icon-help"
              className="block w-full text-[15px] file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-2 file:text-foreground"
            />
          </div>
        </div>
      </details>

      <details className="rounded-lg border border-border bg-card" open={ruleFiles.length > 0}>
        <summary className="cursor-pointer px-4 py-3 font-medium">{t.rules.title}</summary>
        <div className="space-y-4 border-t border-border px-4 py-5">
          <p className="text-muted-foreground">{t.rules.help}</p>
          {ruleFiles.length ? (
            <fieldset>
              <legend className="font-medium">{t.rules.library}</legend>
              <div className="mt-2 space-y-2">
                {ruleFiles.map((f) => (
                  <label key={f.id} className="flex items-center gap-3">
                    <input type="checkbox" name="ruleIds" value={f.id} defaultChecked className="size-5 accent-primary" />
                    <span className="break-all">{f.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="ruleFiles">{t.rules.upload}</Label>
            <p id="rules-help" className="text-muted-foreground">
              {t.rules.uploadHelp}
            </p>
            <input
              id="ruleFiles"
              name="ruleFiles"
              type="file"
              multiple
              accept=".txt,.md,text/plain,text/markdown"
              aria-describedby="rules-help"
              className="block w-full text-[15px] file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-2 file:text-foreground"
            />
          </div>
        </div>
      </details>

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? n.pending : n.submit(scriptCredits)}
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/">{n.cancel}</Link>
        </Button>
      </div>
    </form>
  );
}
