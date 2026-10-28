"use client";

import type { Snapshot } from "@fleetboard/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clock, price } from "@/lib/format";
import type { LinkState } from "@/lib/useSnapshot";

function Clock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-fg">{now ? clock(now) : "--:--:--"}</span>;
}

function NavLink({ href, label }: { href: string; label: string }) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      className={`border-b py-0.5 ${active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
    >
      {label}
    </Link>
  );
}

export function TopBar({ snap, link }: { snap?: Snapshot | null; link?: LinkState }) {
  const rigs = new Map<string, boolean>();
  for (const m of snap?.miners ?? []) rigs.set(m.rig, (rigs.get(m.rig) ?? false) || m.ok);
  const online = [...rigs.values()].filter(Boolean).length;

  return (
    <header className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-line px-4 py-3 text-xs sm:px-6">
      <span className="font-mono text-sm font-bold tracking-[0.35em] text-fg">FLEETBOARD</span>
      <nav className="flex gap-5 tracking-widest">
        <NavLink href="/" label="LIVE" />
        <NavLink href="/history" label="HISTORY" />
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1 tracking-wider text-muted">
        {link && (
          <span className="flex items-center gap-2">
            <span className={`size-1.5 ${link === "live" ? "tick-live bg-accent" : "bg-dim"}`} />
            {link === "live" ? "LINK" : link === "connecting" ? "CONNECTING" : "RECONNECTING"}
          </span>
        )}
        {snap && (
          <span>
            <span className="text-fg">
              {online}/{rigs.size}
            </span>{" "}
            ONLINE
          </span>
        )}
        {snap && (
          <>
            <span>
              XMR <span className="text-fg">{price(snap.coins.XMR.price)}</span>
            </span>
            <span>
              XEL <span className="text-fg">{price(snap.coins.XEL.price)}</span>
            </span>
          </>
        )}
        <Clock />
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="tracking-widest text-muted hover:text-fg">
            LOGOUT
          </button>
        </form>
      </div>
    </header>
  );
}
