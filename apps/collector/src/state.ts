import {
  COIN_IDS,
  COINS,
  computeEarnings,
  type AgentMessage,
  type Coin,
  type CoinAgg,
  type MinerState,
  type RigSummary,
  type Snapshot,
  type Source,
  type WalletReport,
  type WalletState,
} from "@fleetboard/shared";
import type { Market } from "./market.js";

/** A miner instance is DOWN when its agent has been silent this long. */
export const STALE_SEC = 20;
/** Wallets are polled slowly; a reading is current for this long. */
export const WALLET_STALE_SEC = 300;

interface MinerEntry {
  rig: string;
  source: Source;
  coin: Coin;
  summary: RigSummary;
  /** ms epoch of the last report that included this instance. */
  last: number;
  /** The rig's agent reported without this miner: cleanly stopped. */
  off: boolean;
}

interface WalletReading {
  report: WalletReport;
  last: number;
}

/** Emitted for the DB layer: one per instance per accepted report. */
export interface IngestEvent {
  rig: string;
  now: number;
  reported: Array<{ source: Source; coin: Coin; summary: RigSummary }>;
  wallets: WalletReport[];
}

export const minerKey = (rig: string, source: string) => `${rig}/${source}`;
const walletKey = (coin: Coin, address: string) => `${coin}/${address}`;

export class FleetState {
  private readonly miners = new Map<string, MinerEntry>();
  /** wallet key -> reporter (rig or "server") -> latest reading */
  private readonly wallets = new Map<string, Map<string, WalletReading>>();

  constructor(private readonly market: Market) {}

  /**
   * Apply one agent message. The message is authoritative for its rig: any
   * instance of that rig missing from `miners` is marked off.
   */
  ingest(msg: AgentMessage, now = Date.now()): IngestEvent {
    const seen = new Set<string>();
    for (const m of msg.miners) {
      const key = minerKey(msg.name, m.source);
      seen.add(key);
      this.miners.set(key, { rig: msg.name, source: m.source, coin: m.coin, summary: m.summary, last: now, off: false });
    }
    for (const [key, entry] of this.miners) {
      if (entry.rig === msg.name && !seen.has(key)) entry.off = true;
    }
    if (msg.wallets) this.ingestWallets(msg.name, msg.wallets, now);
    return { rig: msg.name, now, reported: msg.miners, wallets: msg.wallets ?? [] };
  }

  ingestWallets(reporter: string, reports: WalletReport[], now = Date.now()): void {
    for (const r of reports) {
      const key = walletKey(r.coin, r.address);
      let byReporter = this.wallets.get(key);
      if (!byReporter) this.wallets.set(key, (byReporter = new Map()));
      byReporter.set(reporter, { report: r, last: now });
    }
  }

  /** Seed instances known from history so a fresh boot shows the whole fleet as off. */
  restoreKnown(rows: Array<{ rig: string; source: Source; coin: Coin; lastSeen: number }>): void {
    for (const r of rows) {
      const key = minerKey(r.rig, r.source);
      if (this.miners.has(key)) continue;
      this.miners.set(key, {
        rig: r.rig,
        source: r.source,
        coin: r.coin,
        summary: { h10: 0, h60: 0, h15: 0, sharesGood: 0, sharesRejected: 0 },
        last: r.lastSeen,
        off: true,
      });
    }
  }

  snapshot(now = Date.now()): Snapshot {
    const miners: MinerState[] = [...this.miners.values()]
      .map((e) => {
        const age = Math.max(0, (now - e.last) / 1000);
        const status = e.off ? "off" : age > STALE_SEC ? "down" : "up";
        return {
          rig: e.rig,
          source: e.source,
          coin: e.coin,
          ok: status === "up",
          status,
          h10: e.summary.h10,
          h60: e.summary.h60,
          h15: e.summary.h15,
          good: e.summary.sharesGood,
          rejected: e.summary.sharesRejected,
          ...(e.summary.device ? { device: e.summary.device } : {}),
          age,
        } satisfies MinerState;
      })
      .sort((a, b) => a.rig.localeCompare(b.rig) || COIN_IDS.indexOf(a.coin) - COIN_IDS.indexOf(b.coin));

    const wallets: WalletState[] = [];
    for (const byReporter of this.wallets.values()) {
      const readings = [...byReporter.entries()].sort((a, b) => b[1].last - a[1].last);
      const [, freshest] = readings[0]!;
      const age = Math.max(0, (now - freshest.last) / 1000);
      const fresh = readings.filter(([, r]) => (now - r.last) / 1000 <= WALLET_STALE_SEC).map(([who]) => who);
      const price = this.market.get(freshest.report.coin).price;
      wallets.push({
        coin: freshest.report.coin,
        address: freshest.report.address,
        via: fresh.length ? fresh : [readings[0]![0]],
        ok: age <= WALLET_STALE_SEC,
        balance: freshest.report.balance,
        ...(freshest.report.unlocked !== undefined ? { unlocked: freshest.report.unlocked } : {}),
        ...(freshest.report.viewOnly !== undefined ? { viewOnly: freshest.report.viewOnly } : {}),
        ...(price !== undefined ? { usd: freshest.report.balance * price } : {}),
        age,
      });
    }
    wallets.sort((a, b) => COIN_IDS.indexOf(a.coin) - COIN_IDS.indexOf(b.coin) || a.address.localeCompare(b.address));

    const coins = {} as Record<Coin, CoinAgg>;
    let usdDayTotal = 0;
    let balanceUsdTotal = 0;
    for (const coin of COIN_IDS) {
      const { price, diff, reward } = this.market.get(coin);
      const totalHr = miners.filter((m) => m.coin === coin && m.ok).reduce((s, m) => s + m.h60, 0);
      const earnings = computeEarnings(totalHr, diff, reward, price, COINS[coin].hashesPerDiff);
      const coinWallets = wallets.filter((w) => w.coin === coin);
      const balance = coinWallets.length ? coinWallets.reduce((s, w) => s + w.balance, 0) : undefined;
      const balanceUsd = balance !== undefined && price !== undefined ? balance * price : undefined;
      coins[coin] = {
        coin,
        totalHr,
        ...(price !== undefined ? { price } : {}),
        ...(diff !== undefined ? { diff } : {}),
        ...(reward !== undefined ? { reward } : {}),
        ...(earnings ? { earnings } : {}),
        ...(balance !== undefined ? { balance } : {}),
        ...(balanceUsd !== undefined ? { balanceUsd } : {}),
      };
      usdDayTotal += earnings?.usdDay ?? 0;
      balanceUsdTotal += balanceUsd ?? 0;
    }

    return {
      updated: now,
      coins,
      miners,
      wallets,
      usdDayTotal,
      usdWeekTotal: usdDayTotal * 7,
      usdMonthTotal: usdDayTotal * 30,
      balanceUsdTotal,
    };
  }
}
