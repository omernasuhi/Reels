"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getDict } from "@/i18n";
import type { ChatMessage, PendingAction } from "@/server/assistant";

const t = getDict();
const a = t.assistant;

type Chat = { messages: ChatMessage[]; pending: PendingAction[]; autoSpend: number; error?: string };

// Proje asistanı: kullanıcı isteğini yazar, asistan uygulamanın işlemlerini kendisi çalıştırır.
export function AssistantPanel({ projectId, refresh }: { projectId: string; refresh: () => Promise<void> }) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const url = `/api/projects/${projectId}/chat`;

  useEffect(() => {
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setChat(c))
      .catch(() => undefined);
  }, [url]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as Chat;
        setChat(next);
        if (next.error) setError(next.error);
      } catch {
        setError(a.failed);
      } finally {
        setBusy(false);
        setWaiting(null);
        await refresh();
      }
    },
    [busy, refresh, url],
  );

  const send = (message: string) => {
    const m = message.trim();
    if (!m || busy) return;
    setWaiting(m);
    setText("");
    post({ message: m });
  };

  const count = chat?.messages.length ?? 0;
  useEffect(() => {
    if (count || waiting) end.current?.scrollIntoView({ block: "nearest" });
  }, [count, waiting]);

  const last = chat?.messages.at(-1);
  const chips = busy ? [] : last?.role === "assistant" && last.options?.length ? last.options : count === 0 ? a.starters : [];

  return (
    <section aria-labelledby="assistant-title" className="mt-12 rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 id="assistant-title" className="text-xl font-semibold">
          {a.title}
        </h2>
        <p className="mt-1 text-muted-foreground">{a.intro}</p>
      </div>

      {count || waiting ? (
        <ol className="max-h-[28rem] space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
          {chat?.messages.map((m) => (
            <li key={m.id}>
              <p className="text-[15px] font-semibold">{m.role === "user" ? a.you : a.name}</p>
              <p className="mt-0.5 whitespace-pre-wrap">{m.text}</p>
            </li>
          ))}
          {waiting ? (
            <li>
              <p className="text-[15px] font-semibold">{a.you}</p>
              <p className="mt-0.5 whitespace-pre-wrap">{waiting}</p>
            </li>
          ) : null}
          {busy ? (
            <li role="status" className="animate-pulse">
              {a.thinking}
            </li>
          ) : null}
          <div ref={end} />
        </ol>
      ) : null}

      {chat?.pending.length ? (
        <div className="border-t border-border px-4 py-4">
          <p className="font-medium">{a.pendingTitle}</p>
          <ul className="mt-2 space-y-3">
            {chat.pending.map((p) => (
              <li key={p.id} className="rounded-md border border-primary p-3">
                <p>{p.label}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => post({ confirm: p.id })}>
                    {a.confirm(p.cost)}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => post({ cancel: p.id })}>
                    {a.cancel}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-3 border-t border-border px-4 py-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {chips.length ? (
          <ul className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => send(c)}
                  className="rounded-full border border-border bg-background px-3.5 py-1.5 text-left text-[15px] hover:border-primary"
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="space-y-2"
        >
          <Label htmlFor="assistant-input" className="sr-only">
            {a.inputLabel}
          </Label>
          <Textarea
            id="assistant-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder={a.placeholder}
            rows={2}
            maxLength={4000}
            className="min-h-20 bg-background"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex flex-wrap items-center gap-2 text-[15px]">
              {a.autoSpendLabel}
              <select
                value={chat?.autoSpend ?? 0}
                disabled={busy || !chat}
                onChange={(e) => post({ autoSpend: Number(e.target.value) })}
                title={a.autoSpendHelp}
                className="h-9 rounded-md border border-input bg-background px-2"
              >
                {Object.entries(a.autoSpendOptions).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline" disabled={busy || !text.trim()}>
              {a.send}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
