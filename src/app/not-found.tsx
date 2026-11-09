import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getDict } from "@/i18n";

export default function NotFound() {
  const t = getDict();
  return (
    <main id="main" className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{t.notFound.title}</h1>
      <p className="mt-3 text-muted-foreground">{t.notFound.body}</p>
      <Button asChild className="mt-8">
        <Link href="/">{t.notFound.back}</Link>
      </Button>
    </main>
  );
}
