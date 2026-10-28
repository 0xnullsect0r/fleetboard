import { COIN_IDS, COINS, type Coin } from "@fleetboard/shared";

export interface NetworkInfo {
  diff: number;
  reward: number;
}

export interface CoinMarket {
  price?: number;
  diff?: number;
  reward?: number;
}

export interface MarketSources {
  prices: () => Promise<Partial<Record<Coin, number>>>;
  network: Record<Coin, () => Promise<NetworkInfo>>;
}

/** XMR block reward is ~0.6 XMR (tail emission) and treated as constant. */
export const XMR_REWARD = 0.6;
const TIMEOUT_MS = 10_000;

async function postJsonRpc<T>(url: string, method: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url} ${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (!body.result) throw new Error(`${url} ${method}: ${body.error?.message ?? "no result"}`);
  return body.result;
}

/** "host:port" -> "http://host:port/json_rpc"; full URLs pass through. */
export function moneroRpcUrl(node: string): string {
  const withScheme = /^https?:\/\//.test(node) ? node : `http://${node}`;
  const u = new URL(withScheme);
  if (u.pathname === "/" || u.pathname === "") u.pathname = "/json_rpc";
  return u.toString();
}

export function liveSources(opts: { diffNode: string; xelNode: string }): MarketSources {
  return {
    async prices() {
      const ids = COIN_IDS.map((c) => COINS[c].geckoId).join(",");
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`coingecko: HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, { usd?: number }>;
      const out: Partial<Record<Coin, number>> = {};
      for (const c of COIN_IDS) {
        const usd = body[COINS[c].geckoId]?.usd;
        if (typeof usd === "number") out[c] = usd;
      }
      return out;
    },
    network: {
      async XMR() {
        const r = await postJsonRpc<{ difficulty: number; wide_difficulty?: string }>(
          moneroRpcUrl(opts.diffNode),
          "get_info",
        );
        return { diff: Number(r.wide_difficulty ?? r.difficulty), reward: XMR_REWARD };
      },
      async XEL() {
        const r = await postJsonRpc<{ difficulty: string | number; miner_reward?: number; block_reward?: number }>(
          opts.xelNode,
          "get_info",
        );
        const atomic = r.miner_reward || r.block_reward || 0;
        return { diff: Number(r.difficulty), reward: atomic / 1e8 };
      },
    },
  };
}

/**
 * Last good price/difficulty/reward per coin. Each source fails on its own;
 * a failed refresh keeps the previous value.
 */
export class Market {
  private readonly data: Record<Coin, CoinMarket>;
  updatedAt = 0;

  constructor(
    private readonly sources: MarketSources,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.data = Object.fromEntries(COIN_IDS.map((c) => [c, {}])) as Record<Coin, CoinMarket>;
  }

  get(coin: Coin): CoinMarket {
    return this.data[coin];
  }

  async refresh(): Promise<void> {
    const tasks: Promise<void>[] = [
      this.sources.prices().then(
        (p) => {
          for (const c of COIN_IDS) if (p[c] !== undefined) this.data[c].price = p[c];
        },
        (e: unknown) => this.log(`price refresh failed: ${String(e)}`),
      ),
      ...COIN_IDS.map((c) =>
        this.sources.network[c]().then(
          (n) => {
            if (Number.isFinite(n.diff) && n.diff > 0) this.data[c].diff = n.diff;
            if (Number.isFinite(n.reward) && n.reward > 0) this.data[c].reward = n.reward;
          },
          (e: unknown) => this.log(`${c} network refresh failed: ${String(e)}`),
        ),
      ),
    ];
    await Promise.all(tasks);
    this.updatedAt = Date.now();
  }
}
