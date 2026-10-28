import { describe, expect, it } from "vitest";
import { FleetState, STALE_SEC, WALLET_STALE_SEC } from "../src/state.js";
import { MARKET, pcMessage, stubMarket } from "./helpers.js";

describe("FleetState status", () => {
  it("marks a miner off when its rig reports without it", async () => {
    const s = new FleetState(await stubMarket());
    const t0 = 1_000_000;
    s.ingest(pcMessage(), t0);
    s.ingest(pcMessage({ miners: pcMessage().miners.slice(0, 1) }), t0 + 5000);
    const snap = s.snapshot(t0 + 6000);
    expect(snap.miners.map((m) => m.status)).toEqual(["up", "off"]);
    expect(snap.coins.XEL.totalHr).toBe(0);
    expect(snap.coins.XEL.earnings?.usdDay).toBe(0);
  });

  it("marks every instance off on a goodbye (empty miners)", async () => {
    const s = new FleetState(await stubMarket());
    s.ingest(pcMessage(), 0);
    s.ingest(pcMessage({ miners: [] }), 1000);
    expect(s.snapshot(2000).miners.every((m) => m.status === "off" && !m.ok)).toBe(true);
  });

  it("marks instances down after STALE_SEC of silence", async () => {
    const s = new FleetState(await stubMarket());
    s.ingest(pcMessage(), 0);
    expect(s.snapshot(STALE_SEC * 1000).miners.every((m) => m.status === "up")).toBe(true);
    const later = s.snapshot(STALE_SEC * 1000 + 1);
    expect(later.miners.every((m) => m.status === "down")).toBe(true);
    expect(later.usdDayTotal).toBe(0);
  });

  it("restores known instances as off and revives them on report", async () => {
    const s = new FleetState(await stubMarket());
    s.restoreKnown([{ rig: "pc", source: "xmrig", coin: "XMR", lastSeen: 0 }]);
    expect(s.snapshot(10).miners[0]?.status).toBe("off");
    s.ingest(pcMessage(), 20);
    expect(s.snapshot(30).miners.map((m) => m.status)).toEqual(["up", "up"]);
  });
});

describe("FleetState wallets", () => {
  const xmr = { coin: "XMR" as const, address: "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx", balance: 1.5, unlocked: 1.25, viewOnly: true };
  const xel = { coin: "XEL" as const, address: "xel:qqqqqqq", balance: 100 };

  it("de-duplicates a wallet seen from pc and server", async () => {
    const s = new FleetState(await stubMarket());
    s.ingest(pcMessage({ wallets: [xmr, xel] }), 0);
    s.ingestWallets("server", [{ ...xmr, balance: 1.6 }], 1000);
    const snap = s.snapshot(2000);
    expect(snap.wallets).toHaveLength(2);
    const w = snap.wallets.find((x) => x.coin === "XMR")!;
    expect(w.balance).toBe(1.6);
    expect(w.via.sort()).toEqual(["pc", "server"]);
    expect(snap.coins.XMR.balance).toBe(1.6);
    expect(snap.coins.XEL.balanceUsd).toBe(100 * MARKET.XEL.price);
    expect(snap.balanceUsdTotal).toBeCloseTo(1.6 * MARKET.XMR.price + 100 * MARKET.XEL.price, 10);
  });

  it("keeps the last balance but flags it stale", async () => {
    const s = new FleetState(await stubMarket());
    s.ingestWallets("pc", [xmr], 0);
    const w = s.snapshot(WALLET_STALE_SEC * 1000 + 1).wallets[0]!;
    expect(w.ok).toBe(false);
    expect(w.balance).toBe(1.5);
    expect(w.via).toEqual(["pc"]);
  });
});
