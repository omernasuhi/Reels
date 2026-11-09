"use client";

import { Button } from "@/components/ui/button";
import { getDict } from "@/i18n";

const t = getDict();

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{t.error.title}</h1>
      <p className="mt-3 text-muted-foreground">{t.error.body}</p>
      <Button className="mt-8" onClick={() => retry()}>
        {t.error.retry}
      </Button>
    </main>
  );
}
