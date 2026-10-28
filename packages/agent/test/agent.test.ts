import { readFileSync } from "node:fs";
import type { AgentMessage, MinerReport, WalletReport } from "@fleetboard/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { assertLoopback, loadConfig, rigName } from "../src/config.js";
import { parseSrbminer, parseXmrig, prettyModel } from "../src/miners.js";

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8")) as unknown;

describe("parsers", () => {
  it("parses XMRig /2/summary", () => {
    expect(parseXmrig(fixture("xmrig-summary.json"))).toEqual({
      source: "xmrig",
      coin: "XMR",
      summary: { h10: 18421.7, h60: 18366.2, h15: 18302.9, sharesGood: 412, sharesRejected: 3, device: "AMD Ryzen 9 7950X 16-Core Processor" },
    });
  });

  it("tolerates XMRig warm-up nulls", () => {
    const r = parseXmrig({ hashrate: { total: [1500, null, null] }, results: { shares_good: 0, shares_total: 0 } });
    expect(r?.summary).toMatchObject({ h10: 1500, h60: 1500, h15: 1500, sharesRejected: 0 });
  });

  it("parses a real SRBMiner-MULTI 3.8 response", () => {
    expect(parseSrbminer(fixture("srbminer.json"))).toEqual({
      source: "srbminer",
      coin: "XEL",
      summary: { h10: 4665.69, h60: 4665.3, h15: 1514.72, sharesGood: 8, sharesRejected: 0, device: "NVIDIA GeForce RTX 4070 Laptop GPU" },
    });
  });

  it("prettifies snake_case GPU models only", () => {
    expect(prettyModel("amd_radeon_rx_7900_xt")).toBe("AMD Radeon RX 7900 XT");
    expect(prettyModel("AMD Radeon RX 7900 XT")).toBe("AMD Radeon RX 7900 XT");
  });

  it("falls back to hashrate_total_now and repeats h10", () => {
    const r = parseSrbminer({ hashrate_total_now: 40_000, algorithms: [{ name: "xelishashv3", shares: { accepted: 2 } }] });
    expect(r?.summary).toMatchObject({ h10: 40_000, h60: 40_000, h15: 40_000, sharesGood: 2, sharesRejected: 0 });
  });

  it("rejects non-miner payloads", () => {
    expect(parseXmrig({ hello: 1 })).toBeNull();
    expect(parseSrbminer("nope")).toBeNull();
  });
});

describe("config", () => {
  it("only allows loopback APIs", () => {
    expect(() => assertLoopback("XMRIG_API", "http://127.0.0.1:18088/2/summary")).not.toThrow();
    expect(() => assertLoopback("XMRIG_API", "http://192.168.1.5:18088")).toThrow(/127\.0\.0\.1/);
    expect(() => loadConfig({ SERVER: "ws://x/ws/agent", TOKEN: "t", XEL_WALLET_RPC: "http://10.0.0.2:8081/json_rpc" })).toThrow();
  });

  it("derives a valid rig name from the hostname", () => {
    expect(rigName("garuda-pc.tail1234.ts.net")).toBe("garuda-pc");
    expect(rigName("Mac Book Pro (2)")).toBe("Mac-Book-Pro-2");
  });

  it("requires SERVER and TOKEN", () => {
    expect(() => loadConfig({ TOKEN: "t" })).toThrow(/SERVER/);
    expect(() => loadConfig({ SERVER: "ws://h:8080/ws/agent" })).toThrow(/TOKEN/);
  });
});

/** Minimal stand-in for the WebSocket the agent dials. */
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: AgentMessage[] = [];
  closed: number | undefined;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(s: string) {
    this.sent.push(JSON.parse(s) as AgentMessage);
  }
  close(code = 1005) {
    this.closed = code;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

describe("Agent lifecycle", () => {
  (globalThis as { WebSocket?: unknown }).WebSocket ??= FakeSocket;
  const xmr: MinerReport = { source: "xmrig", coin: "XMR", summary: { h10: 1, h60: 1, h15: 1, sharesGood: 0, sharesRejected: 0 } };
  const cfg = loadConfig({ SERVER: "ws://collector:8080/ws/agent", TOKEN: "tok", NAME: "garuda-pc" });

  function harness(state: { miners: MinerReport[]; wallets: WalletReport[] }, walletCfg = false) {
    const sockets: FakeSocket[] = [];
    const agent = new Agent(
      walletCfg ? { ...cfg, wallets: [{ coin: "XMR", url: "http://127.0.0.1:18083/json_rpc" }] } : cfg,
      {
        readMiners: async () => state.miners,
        readWallets: async () => state.wallets,
        connect: () => {
          const s = new FakeSocket();
          sockets.push(s);
          return s as unknown as WebSocket;
        },
        now: () => 0,
      },
    );
    return { agent, sockets };
  }

  it("stays offline while nothing local answers", async () => {
    const { agent, sockets } = harness({ miners: [], wallets: [] });
    await agent.cycle();
    await agent.cycle();
    expect(sockets).toHaveLength(0);
  });

  it("connects when a miner appears, reports, then says goodbye when it stops", async () => {
    const state = { miners: [xmr], wallets: [] as WalletReport[] };
    const { agent, sockets } = harness(state);
    await agent.cycle();
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    expect(sockets[0]!.sent[0]?.miners).toHaveLength(1);
    await agent.cycle();
    expect(sockets[0]!.sent).toHaveLength(2);

    state.miners = [];
    await agent.cycle();
    const ws = sockets[0]!;
    expect(ws.sent.at(-1)?.miners).toEqual([]);
    expect(ws.closed).toBe(1000);
    await agent.cycle();
    expect(sockets).toHaveLength(1);
  });

  it("keeps reporting wallets while the miners are idle", async () => {
    const wallet: WalletReport = { coin: "XMR", address: "48abc", balance: 0.5, viewOnly: true };
    const { agent, sockets } = harness({ miners: [], wallets: [wallet] }, true);
    await agent.cycle();
    sockets[0]!.open();
    expect(sockets[0]!.sent[0]).toMatchObject({ miners: [], wallets: [wallet] });
  });
});
