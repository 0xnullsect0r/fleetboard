import type { Earnings } from "./schemas.js";

/**
 * Expected solo-equivalent earnings for a hashrate on a PoW chain:
 *   blocks/day = hr * 86400 / (diff * hashesPerDiff),  coin/day = blocks/day * reward.
 * hashesPerDiff is 1 when difficulty is already in hashes (Monero, Xelis).
 * Returns undefined until difficulty, reward and price are all known.
 */
export function computeEarnings(
  totalHr: number,
  diff: number | undefined,
  reward: number | undefined,
  price: number | undefined,
  hashesPerDiff = 1,
): Earnings | undefined {
  if (diff === undefined || reward === undefined || price === undefined) return undefined;
  if (!(diff > 0) || !Number.isFinite(reward) || !Number.isFinite(price)) return undefined;
  const coinDay = ((totalHr * 86400) / (diff * hashesPerDiff)) * reward;
  const usdDay = coinDay * price;
  return { coinDay, usdDay, usdWeek: usdDay * 7, usdMonth: usdDay * 30 };
}
