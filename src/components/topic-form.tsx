"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getDict } from "@/i18n";
import { createProject, type NewProjectState } from "@/server/actions/projects";

const t = getDict();

export function TopicForm({ initialTopic }: { initialTopic: string }) {
  const [state, action, pending] = useActionState<NewProjectState, FormData>(createProject, {});
  const [topic, setTopic] = useState(initialTopic);

  return (
    <form action={action} className="space-y-6">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="topic">{t.newProject.topicLabel}</Label>
        <p id="topic-help" className="text-muted-foreground">
          {t.newProject.topicHelp}
        </p>
        <Textarea
          id="topic"
          name="topic"
          required
          minLength={10}
          maxLength={2000}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t.newProject.topicPlaceholder}
          aria-describedby="topic-help"
        />
      </div>

      {topic.trim() === "" ? (
        <div>
          <p className="font-medium">{t.newProject.examples}</p>
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

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t.newProject.pending : t.newProject.submit}
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/">{t.newProject.cancel}</Link>
        </Button>
      </div>
    </form>
  );
}
