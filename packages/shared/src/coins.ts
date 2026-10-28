/**
 * Registry of supported miner sources and the coins they mine.
 *
 * Adding a third miner means adding one entry to SOURCE_IDS + SOURCES (and its
 * coin to COIN_IDS + COINS if new). Nothing downstream (DB schema, collector
 * maps, UI table) is keyed on a fixed list.
 */

export const COIN_IDS = ["XMR", "XEL"] as const;
export type Coin = (typeof COIN_IDS)[number];

export const SOURCE_IDS = ["xmrig", "srbminer"] as const;
export type Source = (typeof SOURCE_IDS)[number];

export interface CoinInfo {
  name: string;
  /** CoinGecko asset id used for USD price lookups. */
  geckoId: string;
}

export interface SourceInfo {
  coin: Coin;
  algo: string;
  label: string;
}

export const COINS: Record<Coin, CoinInfo> = {
  XMR: { name: "Monero", geckoId: "monero" },
  XEL: { name: "Xelis", geckoId: "xelis" },
};

export const SOURCES: Record<Source, SourceInfo> = {
  xmrig: { coin: "XMR", algo: "RandomX", label: "XMRig" },
  srbminer: { coin: "XEL", algo: "xelishashv3", label: "SRBMiner" },
};

export function coinForSource(source: Source): Coin {
  return SOURCES[source].coin;
}
