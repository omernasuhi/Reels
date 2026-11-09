import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDict } from "@/i18n";
import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export default async function DashboardPage() {
  const t = getDict();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, status, cover_image_url, created_at")
    .order("created_at", { ascending: false });
  const projects = (data ?? []) as Pick<
    Project,
    "id" | "title" | "status" | "cover_image_url" | "created_at"
  >[];

  if (error) return <Alert tone="error">{t.dashboard.loadError}</Alert>;

  if (projects.length === 0) {
    return (
      <section className="mx-auto max-w-xl py-10 text-center sm:py-20">
        <h1 className="text-3xl font-semibold tracking-tight">{t.dashboard.emptyTitle}</h1>
        <p className="mt-3 text-muted-foreground">{t.dashboard.emptyBody}</p>
        <ul className="mt-8 flex flex-col gap-2 text-left">
          {t.exampleTopics.map((topic) => (
            <li key={topic}>
              <Link
                href={{ pathname: "/projects/new", query: { topic } }}
                className="block rounded-lg border border-border bg-card px-4 py-3 hover:border-primary"
              >
                {topic}
              </Link>
            </li>
          ))}
        </ul>
        <Button asChild size="lg" className="mt-8 w-full sm:w-auto">
          <Link href="/projects/new">{t.dashboard.newProject}</Link>
        </Button>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{t.dashboard.title}</h1>
        <Button asChild>
          <Link href="/projects/new">{t.dashboard.newProject}</Link>
        </Button>
      </div>
      <ul className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {projects.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="group block rounded-lg">
              {/* Kapak kareleri R2'ye bağlanınca imzalı adresle burada gösterilecek. */}
              <div
                role="img"
                aria-label={t.dashboard.noCover}
                className="aspect-[9/16] rounded-lg border border-border bg-muted group-hover:border-primary"
              />
              <h2 className="mt-3 line-clamp-2 text-base font-medium">{p.title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge>{t.projectStatus[p.status]}</Badge>
                <span className="text-[15px] text-muted-foreground">
                  {formatDate(p.created_at)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
