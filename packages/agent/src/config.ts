import { hostname } from "node:os";
import { walletEndpointsFromEnv, type WalletEndpoint } from "@fleetboard/shared";

export interface AgentConfig {
  server: string;
  token: string;
  name: string;
  xmrigApi: string;
  xmrigToken?: string;
  srbminerApi: string;
  /** Seconds between cycles. */
  interval: number;
  wallets: WalletEndpoint[];
  /** Seconds between wallet balance reads. */
  walletInterval: number;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Miner and wallet APIs are only ever read on this host. */
export function assertLoopback(label: string, url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`${label} is not a valid URL: ${url}`);
  }
  if (!LOOPBACK.has(host)) throw new Error(`${label} must point at 127.0.0.1 (got ${host}); the agent never reads remote APIs`);
}

/** Hostname -> a valid rig name (letters, digits, . _ -). */
export function rigName(raw: string): string {
  const n = raw.trim().split(".")[0]!.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return (n || "rig").slice(0, 64);
}

function seconds(v: string | undefined, def: number, min: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const server = env.SERVER?.trim();
  const token = env.TOKEN?.trim();
  if (!server || !/^wss?:\/\//.test(server)) throw new Error("SERVER must be set, e.g. ws://100.64.0.3:8080/ws/agent");
  if (!token) throw new Error("TOKEN must be set (the collector's TOKEN)");

  const cfg: AgentConfig = {
    server,
    token,
    name: rigName(env.NAME || hostname()),
    xmrigApi: env.XMRIG_API || "http://127.0.0.1:18088/2/summary",
    ...(env.XMRIG_TOKEN ? { xmrigToken: env.XMRIG_TOKEN } : {}),
    srbminerApi: env.SRBMINER_API || "http://127.0.0.1:21550",
    interval: seconds(env.INTERVAL, 5, 1),
    wallets: walletEndpointsFromEnv(env),
    walletInterval: seconds(env.WALLET_INTERVAL, 60, 10),
  };
  assertLoopback("XMRIG_API", cfg.xmrigApi);
  assertLoopback("SRBMINER_API", cfg.srbminerApi);
  for (const w of cfg.wallets) assertLoopback(`${w.coin}_WALLET_RPC`, w.url);
  return cfg;
}
