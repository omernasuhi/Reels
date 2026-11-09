"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDict, locales } from "@/i18n";
import { saveSettings, type SettingsState } from "@/server/actions/settings";

const t = getDict();

type Props = { locale: string; defaultVoiceId: string; notifyEmail: boolean };

export function SettingsForm({ locale, defaultVoiceId, notifyEmail }: Props) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSettings, {});
  return (
    <form action={action} className="space-y-6">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert>{t.settings.saved}</Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="locale">{t.settings.language}</Label>
        <select
          id="locale"
          name="locale"
          defaultValue={locale}
          className="h-11 w-full rounded-md border border-input bg-card px-3 text-base"
        >
          {locales.map((l) => (
            <option key={l} value={l}>
              {t.settings.languages[l]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="default_voice_id">{t.settings.voice}</Label>
        <p id="voice-help" className="text-muted-foreground">
          {t.settings.voiceHelp}
        </p>
        <Input
          id="default_voice_id"
          name="default_voice_id"
          defaultValue={defaultVoiceId}
          maxLength={100}
          autoComplete="off"
          aria-describedby="voice-help"
        />
      </div>

      <label className="flex items-center gap-3 text-base">
        <input
          type="checkbox"
          name="notify_email"
          defaultChecked={notifyEmail}
          className="size-5 accent-primary"
        />
        {t.settings.notify}
      </label>

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
        {pending ? t.settings.pending : t.settings.save}
      </Button>
    </form>
  );
}
