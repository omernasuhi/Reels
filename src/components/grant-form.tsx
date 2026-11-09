"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDict } from "@/i18n";
import { grantCreditsAction, type GrantState } from "@/server/actions/admin";

const t = getDict().admin;

export function GrantForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, action, pending] = useActionState<GrantState, FormData>(grantCreditsAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert>{t.grantOk}</Alert> : null}
      <div className="space-y-2">
        <Label htmlFor="grant-email">{t.grantEmail}</Label>
        <Input id="grant-email" name="email" type="email" required defaultValue={defaultEmail} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="grant-amount">{t.grantAmount}</Label>
        <Input id="grant-amount" name="amount" type="number" min={1} max={100000} required defaultValue={500} />
      </div>
      <Button type="submit" disabled={pending}>
        {t.grantSubmit}
      </Button>
    </form>
  );
}
