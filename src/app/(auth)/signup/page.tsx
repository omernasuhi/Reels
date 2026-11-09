import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { getDict } from "@/i18n";

export const metadata: Metadata = { title: getDict().auth.signupTitle };

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
