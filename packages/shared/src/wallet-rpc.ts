import type { Coin, WalletReport } from "./index.js";

/**
 * Minimal clients for the two wallet RPCs we read balances from. Runtime
 * agnostic (global fetch), shared by the bun agent and the node collector.
 *
 *   XMR: monero-wallet-rpc (view-only wallet, --disable-rpc-login on loopback)
 *   XEL: xelis_wallet --rpc-bind-address (HTTP Basic auth)
 */

export interface WalletEndpoint {
  coin: Coin;
  url: string;
  user?: string;
  pass?: string;
}

const ATOMIC: Record<Coin, number> = { XMR: 1e12, XEL: 1e8 };

async function rpc<T>(ep: WalletEndpoint, method: string, params: object, timeoutMs: number): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ep.user || ep.pass) {
    headers.authorization = "Basic " + btoa(`${ep.user ?? ""}:${ep.pass ?? ""}`);
  }
  const res = await fetch(ep.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
  if (body.result === undefined) throw new Error(`${method}: empty result`);
  return body.result;
}

async function readMonero(ep: WalletEndpoint, timeoutMs: number): Promise<WalletReport> {
  const [bal, addr] = await Promise.all([
    rpc<{ balance: number; unlocked_balance: number }>(ep, "get_balance", { account_index: 0 }, timeoutMs),
    rpc<{ address: string }>(ep, "get_address", { account_index: 0 }, timeoutMs),
  ]);
  // A view-only wallet has no spend key; query_key either errors or returns zeros.
  let viewOnly = true;
  try {
    const k = await rpc<{ key: string }>(ep, "query_key", { key_type: "spend_key" }, timeoutMs);
    viewOnly = /^0*$/.test(k.key);
  } catch {
    viewOnly = true;
  }
  return {
    coin: "XMR",
    address: addr.address,
    balance: bal.balance / ATOMIC.XMR,
    unlocked: bal.unlocked_balance / ATOMIC.XMR,
    viewOnly,
  };
}

async function readXelis(ep: WalletEndpoint, timeoutMs: number): Promise<WalletReport> {
  const [bal, address] = await Promise.all([
    rpc<number | string>(ep, "get_balance", {}, timeoutMs),
    rpc<string>(ep, "get_address", {}, timeoutMs),
  ]);
  return { coin: "XEL", address, balance: Number(bal) / ATOMIC.XEL, viewOnly: false };
}

/** Read one wallet; throws if the RPC is unreachable or malformed. */
export function readWallet(ep: WalletEndpoint, timeoutMs = 3000): Promise<WalletReport> {
  return ep.coin === "XMR" ? readMonero(ep, timeoutMs) : readXelis(ep, timeoutMs);
}

/** Wallet endpoints from env-style config; unset URLs are skipped. */
export interface WalletEnv {
  XMR_WALLET_RPC?: string | undefined;
  XEL_WALLET_RPC?: string | undefined;
  XEL_WALLET_USER?: string | undefined;
  XEL_WALLET_PASS?: string | undefined;
}

export function walletEndpointsFromEnv(env: WalletEnv): WalletEndpoint[] {
  const eps: WalletEndpoint[] = [];
  if (env.XMR_WALLET_RPC) eps.push({ coin: "XMR", url: env.XMR_WALLET_RPC });
  if (env.XEL_WALLET_RPC) {
    eps.push({ coin: "XEL", url: env.XEL_WALLET_RPC, user: env.XEL_WALLET_USER, pass: env.XEL_WALLET_PASS });
  }
  return eps;
}

/** Read every endpoint, dropping the ones that do not answer. */
export async function readWallets(eps: WalletEndpoint[], timeoutMs = 3000): Promise<WalletReport[]> {
  const results = await Promise.allSettled(eps.map((ep) => readWallet(ep, timeoutMs)));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
