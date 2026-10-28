"use client";

import { useRouter } from "next/navigation";
import { AuthForm, postJson } from "@/components/AuthForm";

export function FirstRunForm() {
  const router = useRouter();
  return (
    <AuthForm
      title="Replace the default credentials"
      intro={
        <>
          This console still accepts the factory login. Until you replace it, anyone who reaches this address can
          claim the account, so keep the port on Tailscale until this is done. Choose the email you will sign in with
          and a password of at least 10 characters.
        </>
      }
      submit="SAVE AND CONTINUE"
      fields={[
        { name: "newEmail", label: "NEW EMAIL", type: "email", autoComplete: "username" },
        {
          name: "newPassword",
          label: "NEW PASSWORD",
          type: "password",
          autoComplete: "new-password",
          hint: "At least 10 characters. A passphrase works well.",
        },
        { name: "confirm", label: "CONFIRM PASSWORD", type: "password", autoComplete: "new-password" },
      ]}
      onSubmit={async (v) => {
        if (v.newPassword !== v.confirm) return "Passwords do not match.";
        const { ok, data } = await postJson("/api/auth/change", { newEmail: v.newEmail, newPassword: v.newPassword });
        if (!ok) return String(data.error ?? "Could not save credentials.");
        router.replace("/");
        router.refresh();
        return null;
      }}
    />
  );
}
