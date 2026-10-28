"use client";

import { COIN_IDS, COINS, SOURCES, type CoinAgg, type MinerState, type Snapshot } from "@fleetboard/shared";
import { Sparkline } from "@/components/Sparkline";
import { TopBar } from "@/components/TopBar";
import { age, clock, coinAmount, hashrate, hashrateIn, price, shortAddress, si, usd } from "@/lib/format";
import { useSnapshot, type Trace } from "@/lib/useSnapshot";

const label = "text-[11px] tracking-[0.2em] text-muted";

function Hero({ snap }: { snap: Snapshot }) {
  return (
    <section className="flex flex-wrap items-end gap-x-14 gap-y-4 border-b border-line px-4 pb-6 pt-8 sm:px-6">
      <div>
        <div className={label}>PROJECTED · USD / DAY · XMR + XEL</div>
        <div className="font-display text-7xl leading-none font-medium tracking-tight text-accent sm:text-8xl">
          {usd(snap.usdDayTotal)}
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-10 gap-y-3 pb-2">
        {[
          ["/ WEEK", usd(snap.usdWeekTotal)],
          ["/ MONTH", usd(snap.usdMonthTotal)],
          ["HOLDINGS", snap.wallets.length ? usd(snap.balanceUsdTotal) : "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className={label}>{k}</dt>
            <dd className="font-display text-3xl leading-tight text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CoinReadout({ agg, miners, trace }: { agg: CoinAgg; miners: MinerState[]; trace: [number[], number[]] }) {
  const coin = agg.coin;
  const mine = miners.filter((m) => m.coin === coin);
  const up = mine.filter((m) => m.ok).length;
  const algo = Object.values(SOURCES).find((s) => s.coin === coin)?.algo ?? "";
  const hr = hashrate(agg.totalHr);
  const stats: Array<[string, string]> = [
    [`${coin}/DAY`, coinAmount(agg.earnings?.coinDay, coin === "XEL" ? 4 : 6)],
    ["USD/DAY", usd(agg.earnings?.usdDay)],
    ["DIFF", si(agg.diff)],
    ["REWARD", agg.reward !== undefined ? coinAmount(agg.reward, coin === "XMR" ? 2 : 4) : "—"],
  ];

  return (
    <div className="min-w-0 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 text-[11px] tracking-[0.2em]">
        <span className="text-sm font-bold text-fg">{coin}</span>
        <span className="text-muted">
          {COINS[coin].name.toUpperCase()} · {algo.toUpperCase()}
        </span>
        <span className="ml-auto text-muted">
          <span className="text-fg">
            {up}/{mine.length}
          </span>{" "}
          UP
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="font-display text-6xl leading-none font-medium tracking-tight text-accent">{hr.value}</span>
        <span className="font-mono text-lg text-muted">{hr.unit}</span>
      </div>
      <div className="mt-3 border-y border-line">
        <Sparkline data={trace} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] tracking-[0.2em] text-muted">{k}</dt>
            <dd className="text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-x-6 text-xs">
        <span className="text-[10px] tracking-[0.2em] text-muted">BALANCE</span>
        <span className="text-fg">
          {agg.balance !== undefined ? `${coinAmount(agg.balance, coin === "XMR" ? 6 : 4)} ${coin}` : "no wallet reporting"}
        </span>
        {agg.balanceUsd !== undefined && <span className="text-muted">{usd(agg.balanceUsd)}</span>}
      </div>
    </div>
  );
}

function StatusCell({ m }: { m: MinerState }) {
  const tick = m.status === "up" ? "bg-accent" : m.status === "down" ? "bg-crit" : "border border-dim";
  const text = m.status === "down" ? "text-crit" : m.status === "off" ? "text-muted" : "text-fg";
  return (
    <span className={`flex items-center gap-2 ${text}`}>
      <span className={`inline-block size-1.5 ${tick}`} />
      {m.status.toUpperCase()}
      {m.status !== "up" && <span className="text-dim">{age(m.age)}</span>}
    </span>
  );
}

function Rate({ m, v }: { m: MinerState; v: number }) {
  if (m.status === "off") return <span className="text-dim">—</span>;
  const unit = hashrate(m.h60).unit;
  return (
    <>
      {hashrateIn(v, m.h60)}
      <span className="ml-1 text-dim">{unit}</span>
    </>
  );
}

const edge = "first:pl-4 sm:first:pl-6 last:pr-4 sm:last:pr-6";
const th = `${edge} px-3 py-2 text-left font-normal text-[10px] tracking-[0.2em] text-muted`;
const td = `${edge} px-3 py-1.5 whitespace-nowrap`;

function MinerTable({ miners }: { miners: MinerState[] }) {
  if (!miners.length) {
    return (
      <p className="px-4 py-6 text-xs text-muted sm:px-6">
        NO AGENTS HAVE REPORTED. Enroll a rig with install.sh (see README) and it appears here within one interval.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-line-strong">
            <th className={th}>RIG</th>
            <th className={th}>COIN</th>
            <th className={th}>STATUS</th>
            <th className={`${th} text-right`}>10s</th>
            <th className={`${th} text-right`}>60s</th>
            <th className={`${th} text-right`}>15m</th>
            <th className={`${th} text-right`}>ACC/REJ</th>
            <th className={th}>DEVICE</th>
          </tr>
        </thead>
        <tbody>
          {miners.map((m, i) => {
            const firstOfRig = i === 0 || miners[i - 1]!.rig !== m.rig;
            return (
              <tr
                key={`${m.rig}/${m.source}`}
                className={[
                  firstOfRig && i > 0 ? "border-t border-line-strong" : "border-t border-line",
                  i % 2 ? "bg-zebra" : "",
                  m.ok ? "" : "opacity-55",
                  "hover:bg-accent-soft hover:shadow-[inset_2px_0_0_var(--accent)]",
                ].join(" ")}
              >
                <td className={`${td} ${firstOfRig ? "text-fg" : "text-dim"}`}>{m.rig}</td>
                <td className={td}>
                  {m.coin} <span className="text-dim">{SOURCES[m.source].label}</span>
                </td>
                <td className={td}>
                  <StatusCell m={m} />
                </td>
                <td className={`${td} text-right`}>
                  <Rate m={m} v={m.h10} />
                </td>
                <td className={`${td} text-right text-fg`}>
                  <Rate m={m} v={m.h60} />
                </td>
                <td className={`${td} text-right`}>
                  <Rate m={m} v={m.h15} />
                </td>
                <td className={`${td} text-right`}>
                  {m.good}
                  <span className="text-dim"> / </span>
                  {m.rejected}
                </td>
                <td className={`${td} max-w-[22rem] truncate text-muted`} title={m.device}>
                  {m.device ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WalletTable({ snap }: { snap: Snapshot }) {
  if (!snap.wallets.length) return null;
  return (
    <section className="border-t border-line">
      <h2 className={`${label} px-4 pt-6 pb-2 sm:px-6`}>WALLETS</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-line-strong">
              <th className={th}>COIN</th>
              <th className={th}>ADDRESS</th>
              <th className={`${th} text-right`}>BALANCE</th>
              <th className={`${th} text-right`}>UNLOCKED</th>
              <th className={`${th} text-right`}>USD</th>
              <th className={th}>VIA</th>
              <th className={`${th} text-right`}>AGE</th>
            </tr>
          </thead>
          <tbody>
            {snap.wallets.map((w, i) => {
              const d = w.coin === "XMR" ? 6 : 4;
              return (
                <tr
                  key={`${w.coin}/${w.address}`}
                  className={`border-t border-line ${i % 2 ? "bg-zebra" : ""} ${w.ok ? "" : "opacity-55"} hover:bg-accent-soft hover:shadow-[inset_2px_0_0_var(--accent)]`}
                >
                  <td className={td}>
                    {w.coin} {w.viewOnly && <span className="text-dim">VIEW-ONLY</span>}
                  </td>
                  <td className={`${td} text-muted`} title={w.address}>
                    {shortAddress(w.address)}
                  </td>
                  <td className={`${td} text-right text-fg`}>{coinAmount(w.balance, d)}</td>
                  <td className={`${td} text-right`}>{w.unlocked !== undefined ? coinAmount(w.unlocked, d) : "—"}</td>
                  <td className={`${td} text-right`}>{usd(w.usd)}</td>
                  <td className={`${td} text-muted`}>{w.via.join(", ")}</td>
                  <td className={`${td} text-right ${w.ok ? "text-muted" : "text-crit"}`}>{age(w.age)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Footer({ snap }: { snap: Snapshot | null }) {
  return (
    <footer className="flex flex-wrap gap-x-8 gap-y-1 border-t border-line px-4 py-4 text-[11px] tracking-wider text-muted sm:px-6">
      <span>UPDATED {snap ? clock(snap.updated) : "—"}</span>
      <span>SOURCES: XMRig + SRBMiner agents · P2Pool (XMR) · Kryptex (XEL) · CoinGecko · node get_info</span>
      <span>COVERS XMR + XEL · ESTIMATES ASSUME CURRENT DIFFICULTY</span>
    </footer>
  );
}

export function LiveConsole({ seed }: { seed?: Trace }) {
  const { snap, link, trace } = useSnapshot(seed);
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar snap={snap} link={link} />
      {!snap ? (
        <p className="px-4 py-10 text-xs tracking-[0.2em] text-muted sm:px-6">AWAITING TELEMETRY…</p>
      ) : (
        <main className="flex-1">
          <Hero snap={snap} />
          <section
            className="grid grid-cols-1 border-b border-line lg:grid-cols-[repeat(var(--coins),minmax(0,1fr))] lg:divide-x lg:divide-line"
            style={{ "--coins": COIN_IDS.length } as React.CSSProperties}
          >
            {COIN_IDS.map((c) => (
              <CoinReadout key={c} agg={snap.coins[c]} miners={snap.miners} trace={trace[c]} />
            ))}
          </section>
          <h2 className={`${label} px-4 pt-6 pb-2 sm:px-6`}>MINERS</h2>
          <MinerTable miners={snap.miners} />
          <WalletTable snap={snap} />
        </main>
      )}
      <Footer snap={snap} />
    </div>
  );
}
