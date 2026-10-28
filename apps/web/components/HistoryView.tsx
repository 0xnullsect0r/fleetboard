"use client";

import type { Coin } from "@fleetboard/shared";
import { useEffect, useState } from "react";
import { TimeChart } from "@/components/TimeChart";
import { TopBar } from "@/components/TopBar";
import { coinAmount, hashrateText } from "@/lib/format";

const RANGES = ["1h", "6h", "24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];

interface SeriesSet {
  t: number[];
  series: Array<{ key: string; label: string; coin: Coin; values: (number | null)[] }>;
}

const hr = (v: number) => hashrateText(v, 1);
const bal = (coin: Coin) => (v: number) => `${coinAmount(v, coin === "XMR" ? 4 : 2)} ${coin}`;
const balFormats: Record<Coin, (v: number) => string> = { XMR: bal("XMR"), XEL: bal("XEL") };
const label = "text-[11px] tracking-[0.2em] text-muted";

async function load(kind: string, range: Range): Promise<SeriesSet> {
  const res = await fetch(`/api/history/${kind}?range=${range}`, { cache: "no-store" });
  if (res.status === 401) window.location.assign("/login");
  if (!res.ok) throw new Error(`${kind}: ${res.status}`);
  return res.json() as Promise<SeriesSet>;
}

export function HistoryView() {
  const [range, setRange] = useState<Range>("24h");
  const [data, setData] = useState<{ coins: SeriesSet; miners: SeriesSet; wallets: SeriesSet } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const fetchAll = () =>
      Promise.all([load("coins", range), load("miners", range), load("wallets", range)]).then(
        ([coins, miners, wallets]) => {
          if (!live) return;
          setData({ coins, miners, wallets });
          setError(null);
        },
        (e: unknown) => live && setError(String(e)),
      );
    void fetchAll();
    const timer = setInterval(fetchAll, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [range]);

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-3 text-xs sm:px-6">
        <span className={label}>RANGE</span>
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`border-b py-0.5 tracking-widest ${r === range ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {r.toUpperCase()}
          </button>
        ))}
        {error && <span className="text-crit">HISTORY UNAVAILABLE · {error}</span>}
      </div>
      {!data ? (
        <p className="px-4 py-10 text-xs tracking-[0.2em] text-muted sm:px-6">LOADING HISTORY…</p>
      ) : (
        <main className="flex-1">
          <section className="grid grid-cols-1 border-b border-line lg:grid-cols-2 lg:divide-x lg:divide-line">
            {data.coins.series.map((s) => (
              <div key={s.key} className="px-4 py-5 sm:px-6">
                <TimeChart title={`FLEET HASHRATE · ${s.coin}`} t={data.coins.t} values={s.values} format={hr} height={220} />
              </div>
            ))}
          </section>
          {data.wallets.series.length > 0 && (
            <section className="grid grid-cols-1 border-b border-line lg:grid-cols-2 lg:divide-x lg:divide-line">
              {data.wallets.series.map((s) => (
                <div key={s.key} className="px-4 py-5 sm:px-6">
                  <TimeChart title={`WALLET BALANCE · ${s.coin}`} t={data.wallets.t} values={s.values} format={balFormats[s.coin]} height={140} fill={false} />
                </div>
              ))}
            </section>
          )}
          <h2 className={`${label} px-4 pt-6 pb-2 sm:px-6`}>PER MINER INSTANCE · 60s HASHRATE</h2>
          {data.miners.series.length === 0 ? (
            <p className="px-4 pb-6 text-xs text-muted sm:px-6">No samples in this range.</p>
          ) : (
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 [&>*]:border-t [&>*]:border-line">
              {data.miners.series.map((s) => (
                <div key={s.key} className="px-4 py-4 sm:px-6">
                  <TimeChart title={s.label.toUpperCase()} t={data.miners.t} values={s.values} format={hr} height={110} />
                </div>
              ))}
            </section>
          )}
        </main>
      )}
      <footer className="border-t border-line px-4 py-4 text-[11px] tracking-wider text-muted sm:px-6">
        HASHRATE = 60s AVERAGE, SAMPLED EVERY 15s PER INSTANCE · BALANCES SAMPLED EVERY 5m · GAPS = INSTANCE NOT REPORTING
      </footer>
    </div>
  );
}
