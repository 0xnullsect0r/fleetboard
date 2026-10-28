import type { Earnings } from "./schemas.js";

/**
 * Expected earnings for a hashrate on a PoW chain whose difficulty is the
 * expected number of hashes per block (true for both Monero and Xelis):
 *   blocks/day = hr * 86400 / diff,  coin/day = blocks/day * reward.
 * Returns undefined until difficulty, reward and price are all known.
 */
export function computeEarnings(
  totalHr: number,
  diff: number | undefined,
  reward: number | undefined,
  price: number | undefined,
): Earnings | undefined {
  if (diff === undefined || reward === undefined || price === undefined) return undefined;
  if (!(diff > 0) || !Number.isFinite(reward) || !Number.isFinite(price)) return undefined;
  const coinDay = ((totalHr * 86400) / diff) * reward;
  const usdDay = coinDay * price;
  return { coinDay, usdDay, usdWeek: usdDay * 7, usdMonth: usdDay * 30 };
}
