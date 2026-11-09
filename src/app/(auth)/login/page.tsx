import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { getDict } from "@/i18n";

const t = getDict();
export const metadata: Metadata = { title: t.auth.loginTitle };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return <AuthForm mode="login" notice={error === "link" ? t.auth.errors.linkInvalid : undefined} />;
}
