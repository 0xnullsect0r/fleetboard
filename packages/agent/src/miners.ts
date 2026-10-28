import type { MinerReport } from "@fleetboard/shared";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const int = (v: unknown): number => Math.max(0, Math.trunc(num(v) ?? 0));
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);

/**
 * XMRig HTTP API /2/summary:
 *   hashrate.total = [10s, 60s, 15m] (entries are null while warming up),
 *   results.shares_good / shares_total, cpu.brand.
 */
export function parseXmrig(body: unknown): MinerReport | null {
  const j = obj(body);
  const total = obj(j?.hashrate)?.total;
  if (!Array.isArray(total)) return null;
  const h10 = num(total[0]) ?? 0;
  const h60 = num(total[1]) ?? h10;
  const h15 = num(total[2]) ?? h60;
  const results = obj(j?.results);
  const good = int(results?.shares_good);
  const all = Math.max(good, int(results?.shares_total));
  const device = str(obj(j?.cpu)?.brand);
  return {
    source: "xmrig",
    coin: "XMR",
    summary: { h10, h60, h15, sharesGood: good, sharesRejected: all - good, ...(device ? { device } : {}) },
  };
}

/** First defined numeric value among dotted paths. */
function pick(root: Json | undefined, paths: string[]): number | undefined {
  for (const p of paths) {
    let cur: unknown = root;
    for (const k of p.split(".")) cur = obj(cur)?.[k];
    const n = num(cur);
    if (n !== undefined) return n;
  }
  return undefined;
}

/**
 * SRBMiner-MULTI API (GET :21550). Field names vary across releases, so each
 * value is taken from the first path that exists:
 *   h10 = algorithms[i].hashrate.(gpu.total | total | now), else hashrate_total_now
 *   h60 / h15 from the 1min / 15min fields when present, else h10
 *   shares from algorithms[i].shares.accepted / rejected, device = first GPU name.
 * The XEL algorithm (xelishash*) is preferred when several are mined.
 */
export function parseSrbminer(body: unknown): MinerReport | null {
  const j = obj(body);
  const algos = Array.isArray(j?.algorithms) ? (j.algorithms as unknown[]).map(obj).filter((a): a is Json => !!a) : [];
  const algo = algos.find((a) => /xelis/i.test(String(a.name ?? ""))) ?? algos[0];
  const hr = obj(algo?.hashrate);

  const h10 = pick(hr, ["gpu.total", "total", "now", "gpu.now"]) ?? pick(j, ["hashrate_total_now"]);
  if (h10 === undefined) return null;
  const h60 = pick(hr, ["gpu.1min", "1min", "gpu.60s", "60s"]) ?? pick(j, ["hashrate_total_1min"]) ?? h10;
  const h15 = pick(hr, ["gpu.15min", "15min"]) ?? pick(j, ["hashrate_total_15min"]) ?? h60;

  const shares = obj(algo?.shares);
  const gpus = [j?.gpu_devices, j?.devices, j?.gpus].find(Array.isArray) as unknown[] | undefined;
  const g = obj(gpus?.[0]);
  const device = str(g?.model) ?? str(g?.name) ?? str(g?.device);

  return {
    source: "srbminer",
    coin: "XEL",
    summary: {
      h10,
      h60,
      h15,
      sharesGood: int(shares?.accepted),
      sharesRejected: int(shares?.rejected),
      ...(device ? { device } : {}),
    },
  };
}

async function getJson(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface MinerApis {
  xmrigApi: string;
  xmrigToken?: string;
  srbminerApi: string;
}

/** Every local miner that answered this cycle (0, 1 or 2 reports). */
export async function readMiners(apis: MinerApis, timeoutMs = 2000): Promise<MinerReport[]> {
  const [x, s] = await Promise.allSettled([
    getJson(apis.xmrigApi, timeoutMs, apis.xmrigToken ? { authorization: `Bearer ${apis.xmrigToken}` } : {}).then(parseXmrig),
    getJson(apis.srbminerApi, timeoutMs).then(parseSrbminer),
  ]);
  return [x, s].flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}
