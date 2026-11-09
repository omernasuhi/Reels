"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDict } from "@/i18n";
import { login, signup, type AuthState } from "@/server/actions/auth";

const t = getDict();

export function AuthForm({ mode, notice }: { mode: "login" | "signup"; notice?: string }) {
  const isLogin = mode === "login";
  const [state, action, pending] = useActionState<AuthState, FormData>(
    isLogin ? login : signup,
    {},
  );

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">
        {isLogin ? t.auth.loginTitle : t.auth.signupTitle}
      </h1>
      <p className="mt-2 text-muted-foreground">{t.app.tagline}</p>

      <form action={action} className="mt-8 space-y-5">
        {notice && !state.error && !state.message ? <Alert tone="error">{notice}</Alert> : null}
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.message ? <Alert>{state.message}</Alert> : null}

        <div className="space-y-2">
          <Label htmlFor="email">{t.auth.email}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            defaultValue={state.email}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t.auth.password}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            minLength={8}
            required
            aria-describedby={isLogin ? undefined : "password-hint"}
          />
          {isLogin ? null : (
            <p id="password-hint" className="text-[15px] text-muted-foreground">
              {t.auth.passwordHint}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? t.auth.pending : isLogin ? t.auth.loginSubmit : t.auth.signupSubmit}
        </Button>
      </form>

      <p className="mt-6 text-base text-muted-foreground">
        {isLogin ? t.auth.noAccount : t.auth.haveAccount}{" "}
        <Link
          href={isLogin ? "/signup" : "/login"}
          className="text-foreground underline underline-offset-4"
        >
          {isLogin ? t.auth.toSignup : t.auth.toLogin}
        </Link>
      </p>
    </div>
  );
}
