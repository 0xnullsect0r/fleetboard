import { describe, expect, it } from "vitest";
import {
  AgentMessageSchema,
  SnapshotSchema,
  SOURCES,
  SOURCE_IDS,
  computeEarnings,
} from "../src/index.js";

describe("source registry", () => {
  it("maps every source to a coin", () => {
    expect(SOURCES.xmrig.coin).toBe("XMR");
    expect(SOURCES.srbminer.coin).toBe("XEL");
    for (const s of SOURCE_IDS) expect(SOURCES[s]).toBeDefined();
  });
});

describe("AgentMessage", () => {
  const msg = {
    token: "t",
    name: "pc",
    ts: 1_700_000_000_000,
    miners: [
      { source: "xmrig", coin: "XMR", summary: { h10: 1, h60: 2, h15: 3, sharesGood: 4, sharesRejected: 0 } },
      { source: "srbminer", coin: "XEL", summary: { h10: 5, h60: 5, h15: 5, sharesGood: 1, sharesRejected: 1, device: "RX 6600" } },
    ],
  };

  it("accepts a two-miner message", () => {
    expect(AgentMessageSchema.parse(msg).miners).toHaveLength(2);
  });

  it("accepts an empty miners list", () => {
    expect(AgentMessageSchema.safeParse({ ...msg, miners: [] }).success).toBe(true);
  });

  it("rejects unknown sources and bad rig names", () => {
    expect(AgentMessageSchema.safeParse({ ...msg, miners: [{ ...msg.miners[0], source: "lolminer" }] }).success).toBe(false);
    expect(AgentMessageSchema.safeParse({ ...msg, name: "pc/../x" }).success).toBe(false);
  });

  it("accepts wallet balances alongside miners", () => {
    const m = AgentMessageSchema.parse({ ...msg, miners: [], wallets: [{ coin: "XMR", balance: 0.42, unlocked: 0.4, viewOnly: true }] });
    expect(m.wallets?.[0]?.coin).toBe("XMR");
  });

  it("rejects negative hashrate", () => {
    const bad = structuredClone(msg);
    bad.miners[0]!.summary.h10 = -1;
    expect(AgentMessageSchema.safeParse(bad).success).toBe(false);
  });
});

describe("Snapshot", () => {
  it("requires every coin key", () => {
    const base = { updated: 0, miners: [], wallets: [], usdDayTotal: 0, usdWeekTotal: 0, usdMonthTotal: 0, balanceUsdTotal: 0 };
    expect(SnapshotSchema.safeParse({ ...base, coins: { XMR: { coin: "XMR", totalHr: 0 } } }).success).toBe(false);
    expect(
      SnapshotSchema.safeParse({
        ...base,
        coins: { XMR: { coin: "XMR", totalHr: 0 }, XEL: { coin: "XEL", totalHr: 0 } },
      }).success,
    ).toBe(true);
  });
});

describe("computeEarnings", () => {
  it("computes coin/day and usd projections", () => {
    // 10 kH/s on a 300G-difficulty chain, 0.6 reward, $150
    const e = computeEarnings(10_000, 300e9, 0.6, 150)!;
    expect(e.coinDay).toBeCloseTo((10_000 * 86400 * 0.6) / 300e9, 12);
    expect(e.usdDay).toBeCloseTo(e.coinDay * 150, 12);
    expect(e.usdWeek).toBeCloseTo(e.usdDay * 7, 12);
    expect(e.usdMonth).toBeCloseTo(e.usdDay * 30, 12);
  });

  it("is undefined until inputs are known", () => {
    expect(computeEarnings(1, undefined, 0.6, 1)).toBeUndefined();
    expect(computeEarnings(1, 0, 0.6, 1)).toBeUndefined();
    expect(computeEarnings(1, 1, 0.6, undefined)).toBeUndefined();
  });
});
