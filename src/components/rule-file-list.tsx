"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { getDict } from "@/i18n";
import { deleteRuleFile } from "@/server/actions/projects";

const t = getDict().rules;

// Kullanıcının kural dosyası kitaplığı. Yeni dosyalar proje oluştururken eklenir.
export function RuleFileList({ files }: { files: { id: string; name: string }[] }) {
  const [, action, pending] = useActionState(deleteRuleFile, {});
  if (!files.length) return <p className="mt-3">{t.none}</p>;
  return (
    <ul className="mt-3 divide-y divide-border border-y border-border">
      {files.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-3 py-2">
          <span className="break-all">{f.name}</span>
          <form action={action}>
            <input type="hidden" name="id" value={f.id} />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              {t.delete}
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}
