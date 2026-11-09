"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDict } from "@/i18n";
import type { ActionResult } from "@/server/actions/projects";
import type { ProjectState } from "@/server/state";

const t = getDict();

export function isActive(s: ProjectState): boolean {
  return (
    Boolean(s.project.job_step) ||
    s.project.status === "producing" ||
    s.project.status === "rendering" ||
    s.characters.some((c) => c.status === "generating") ||
    s.frames.some((f) => ["queued", "generating", "checking", "fixing"].includes(f.status) && s.project.status !== "characters")
  );
}

// Proje durumunu yoklar: iş sürerken 2,5 sn'de bir, değilse yalnızca istek üzerine.
export function useProjectState(initial: ProjectState) {
  const [state, setState] = useState(initial);
  const [failed, setFailed] = useState(false);
  const id = initial.project.id;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}/state`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setState(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [id]);

  const active = isActive(state);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [active, refresh]);

  return { state, refresh, failed };
}

// Sunucu eylemini çalıştırır; bekleme ve hata durumunu tutar, sonra durumu yeniler.
export function useAction(refresh: () => Promise<void>) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const run = useCallback(
    async (key: string, fn: () => Promise<ActionResult>) => {
      if (busy.current) return;
      busy.current = true;
      setPending(key);
      setError(null);
      try {
        const result = await fn();
        if (result?.error) setError(result.error);
      } catch {
        setError(t.common.actionFailed);
      } finally {
        await refresh();
        busy.current = false;
        setPending(null);
      }
    },
    [refresh],
  );
  return { run, pending, error };
}

export function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

type ProgressProps = {
  label: string;
  // Gerçek ilerleme biliniyorsa 0-1; bilinmiyorsa süreye göre tahmin edilir.
  fraction?: number;
  startedAt?: string | null;
  expectedSeconds?: number;
  detail?: string;
};

// Uzun işlemler için: adım adı + yüzde + tahmini kalan süre.
export function JobProgress({ label, fraction, startedAt, expectedSeconds = 60, detail }: ProgressProps) {
  const now = useNow(true);
  const elapsed = startedAt ? Math.max(0, (now - new Date(startedAt).getTime()) / 1000) : 0;
  let f: number;
  let remaining: number;
  if (fraction !== undefined) {
    f = fraction;
    remaining = f > 0.08 && elapsed > 5 ? (elapsed * (1 - f)) / f : expectedSeconds * (1 - f);
  } else {
    // Asimptotik: beklenen sürede %80'e, sonra yavaşça %97'ye yaklaşır.
    f = Math.min(0.97, 1 - Math.exp((-1.6 * elapsed) / expectedSeconds));
    remaining = expectedSeconds - elapsed;
  }
  const percent = Math.round(Math.min(1, Math.max(0, f)) * 100);
  return (
    <div className="rounded-lg border border-border bg-card p-5" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-medium">{label}</p>
        <p className="tabular-nums font-medium">%{percent}</p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-3">
        {remaining > 4 ? t.common.eta(remaining) : t.common.almostDone}
        {detail ? ` · ${detail}` : ""}
      </p>
      <p className="mt-1 text-muted-foreground">{t.common.backgroundNote}</p>
    </div>
  );
}
