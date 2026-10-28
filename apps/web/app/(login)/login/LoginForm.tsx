"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AuthForm, postJson } from "@/components/AuthForm";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <AuthForm
      title="Sign in"
      intro="Single-operator console. Credentials are set during first-run."
      submit="SIGN IN"
      fields={[
        { name: "email", label: "EMAIL", type: "email", autoComplete: "username" },
        { name: "password", label: "PASSWORD", type: "password", autoComplete: "current-password" },
      ]}
      onSubmit={async (v) => {
        const { ok, data } = await postJson("/api/auth/login", { email: v.email, password: v.password });
        if (!ok) return String(data.error ?? "Sign-in failed.");
        const next = params.get("next");
        router.replace(data.mustChange ? "/first-run" : next?.startsWith("/") && !next.startsWith("//") ? next : "/");
        router.refresh();
        return null;
      }}
    />
  );
}
