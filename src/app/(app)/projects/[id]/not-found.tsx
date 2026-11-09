import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getDict } from "@/i18n";

export default function ProjectNotFound() {
  const t = getDict();
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{t.project.notFoundTitle}</h1>
      <p className="mt-3 text-muted-foreground">{t.project.notFoundBody}</p>
      <Button asChild className="mt-8">
        <Link href="/">{t.project.back}</Link>
      </Button>
    </div>
  );
}
