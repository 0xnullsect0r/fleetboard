"use client";

import { COIN_IDS, type Coin, type Snapshot } from "@fleetboard/shared";
import { useEffect, useRef, useState } from "react";

export type LinkState = "connecting" | "live" | "retrying";

/** Rolling per-coin hashrate trace for the sparklines: [unix seconds[], H/s[]]. */
export type Trace = Record<Coin, [number[], number[]]>;

const TRACE_WINDOW_SEC = 15 * 60;
const MAX_BACKOFF_MS = 30_000;

function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/ui`;
}

const emptyTrace = (): Trace =>
  Object.fromEntries(COIN_IDS.map((c) => [c, [[], []]])) as unknown as Trace;

/**
 * Subscribes to /ws/ui with exponential-backoff reconnect and keeps a short
 * client-side trace of per-coin totals. `seed` pre-fills the trace (history).
 */
export function useSnapshot(seed?: Trace) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [link, setLink] = useState<LinkState>("connecting");
  const [trace, setTrace] = useState<Trace>(emptyTrace);
  const seeded = useRef(false);

  useEffect(() => {
    if (!seed || seeded.current) return;
    seeded.current = true;
    setTrace((cur) => {
      const out = emptyTrace();
      for (const c of COIN_IDS) {
        const [st, sv] = seed[c];
        const [ct, cv] = cur[c];
        const firstLive = ct[0] ?? Infinity;
        const keep = st.map((t, i) => [t, sv[i]!] as const).filter(([t]) => t < firstLive);
        out[c] = [[...keep.map(([t]) => t), ...ct], [...keep.map(([, v]) => v), ...cv]];
      }
      return out;
    });
  }, [seed]);

  useEffect(() => {
    let ws: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;
    let stopped = false;
    let failures = 0;

    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        backoff = 1000;
        failures = 0;
        setLink("live");
      };
      ws.onmessage = (ev) => {
        const s = JSON.parse(String(ev.data)) as Snapshot;
        setSnap(s);
        const t = Math.floor(s.updated / 1000);
        setTrace((cur) => {
          const out = { ...cur };
          for (const c of COIN_IDS) {
            const [ts, vs] = cur[c];
            if (ts.length && ts[ts.length - 1]! >= t) continue;
            const cut = ts.findIndex((x) => x >= t - TRACE_WINDOW_SEC);
            const from = cut < 0 ? ts.length : cut;
            out[c] = [[...ts.slice(from), t], [...vs.slice(from), s.coins[c].totalHr]];
          }
          return out;
        });
      };
      ws.onclose = () => {
        if (stopped) return;
        setLink("retrying");
        failures++;
        // Repeated handshake failures usually mean the session expired.
        if (failures >= 3) {
          void fetch("/api/auth/me").then((r) => {
            if (r.status === 401) window.location.assign("/login");
          }, () => {});
        }
        timer = setTimeout(connect, backoff + Math.random() * 300);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { snap, link, trace };
}
