"use client";

import { useState, type FormEvent, type ReactNode } from "react";

export interface Field {
  name: string;
  label: string;
  type: "email" | "password" | "text";
  autoComplete: string;
  hint?: string;
  defaultValue?: string;
}

/** Shared console-styled form: labelled mono inputs, one action, inline error. */
export function AuthForm({
  title,
  intro,
  fields,
  submit,
  onSubmit,
}: {
  title: string;
  intro?: ReactNode;
  fields: Field[];
  submit: string;
  onSubmit: (values: Record<string, string>) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const values = Object.fromEntries([...new FormData(e.currentTarget)].map(([k, v]) => [k, String(v)]));
    const err = await onSubmit(values).catch(() => "Network error. Is the server reachable?");
    setError(err);
    setBusy(false);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line px-4 py-3 sm:px-6">
        <span className="text-sm font-bold tracking-[0.35em]">FLEETBOARD</span>
      </header>
      <main className="px-4 py-10 sm:px-6">
        <h1 className="font-display text-4xl font-medium tracking-tight text-accent">{title}</h1>
        {intro && <div className="mt-3 max-w-xl text-xs leading-relaxed text-muted">{intro}</div>}
        <form onSubmit={handle} className="mt-8 grid max-w-md gap-5" noValidate>
          {fields.map((f) => (
            <label key={f.name} className="grid gap-1.5">
              <span className="text-[10px] tracking-[0.2em] text-muted">{f.label}</span>
              <input
                name={f.name}
                type={f.type}
                autoComplete={f.autoComplete}
                defaultValue={f.defaultValue}
                required
                className="border border-line-strong bg-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
              {f.hint && <span className="text-[11px] text-dim">{f.hint}</span>}
            </label>
          ))}
          {error && (
            <p role="alert" className="flex items-center gap-2 text-xs text-crit">
              <span className="inline-block size-1.5 bg-crit" />
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="justify-self-start border border-accent px-5 py-2 text-xs tracking-[0.25em] text-accent hover:bg-accent hover:text-bg disabled:opacity-50"
          >
            {busy ? "WORKING…" : submit}
          </button>
        </form>
      </main>
    </div>
  );
}

export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
