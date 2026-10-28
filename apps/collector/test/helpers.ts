import type { AgentMessage } from "@fleetboard/shared";
import { Market } from "../src/market.js";

export const TOKEN = "test-token-0123456789abcdef";

export const MARKET = {
  XMR: { price: 200, diff: 400e9, reward: 0.6 },
  XEL: { price: 5, diff: 1e10, reward: 1.2 },
};

export async function stubMarket(): Promise<Market> {
  const m = new Market({
    prices: async () => ({ XMR: MARKET.XMR.price, XEL: MARKET.XEL.price }),
    network: {
      XMR: async () => ({ diff: MARKET.XMR.diff, reward: MARKET.XMR.reward }),
      XEL: async () => ({ diff: MARKET.XEL.diff, reward: MARKET.XEL.reward }),
    },
  });
  await m.refresh();
  return m;
}

export function pcMessage(over: Partial<AgentMessage> = {}): AgentMessage {
  return {
    token: TOKEN,
    name: "pc",
    ts: Date.now(),
    miners: [
      {
        source: "xmrig",
        coin: "XMR",
        summary: { h10: 12_100, h60: 12_000, h15: 11_900, sharesGood: 40, sharesRejected: 1, device: "AMD Ryzen 9 7950X" },
      },
      {
        source: "srbminer",
        coin: "XEL",
        summary: { h10: 2.1e6, h60: 2e6, h15: 2e6, sharesGood: 12, sharesRejected: 0, device: "AMD Radeon RX 7900 XT" },
      },
    ],
    ...over,
  };
}

export const coinDay = (hr: number, c: keyof typeof MARKET) => ((hr * 86400) / MARKET[c].diff) * MARKET[c].reward;
