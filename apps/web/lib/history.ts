import "server-only";
import { COIN_IDS, SOURCES, type Coin, type Source } from "@fleetboard/shared";
import { db } from "@/lib/db";

export const RANGES = {
  "15m": { sec: 15 * 60, bucket: 15 },
  "1h": { sec: 3600, bucket: 30 },
  "6h": { sec: 6 * 3600, bucket: 120 },
  "24h": { sec: 86400, bucket: 600 },
  "7d": { sec: 7 * 86400, bucket: 3600 },
  "30d": { sec: 30 * 86400, bucket: 4 * 3600 },
} as const;
export type Range = keyof typeof RANGES;
export const isRange = (r: string | null): r is Range => r !== null && r in RANGES;

export interface Series {
  key: string;
  label: string;
  coin: Coin;
  values: (number | null)[];
}

/** uPlot-aligned series on a fixed bucket grid (unix seconds). */
export interface SeriesSet {
  range: Range;
  bucket: number;
  t: number[];
  series: Series[];
}

type Fill = "zero" | "gap" | "carry";

function grid(range: Range, now = Date.now()): number[] {
  const { sec, bucket } = RANGES[range];
  const end = Math.floor(now / 1000 / bucket) * bucket;
  const out: number[] = [];
  for (let t = end - Math.floor(sec / bucket) * bucket; t <= end; t += bucket) out.push(t);
  return out;
}

function align(range: Range, rows: Array<{ t: number; key: string; v: number }>, meta: Map<string, Omit<Series, "values">>, fill: Fill): SeriesSet {
  const t = grid(range);
  const index = new Map(t.map((x, i) => [x, i]));
  const series = [...meta.values()].map((m) => ({ ...m, values: new Array<number | null>(t.length).fill(fill === "zero" ? 0 : null) }));
  const byKey = new Map(series.map((s) => [s.key, s]));
  for (const r of rows) {
    const i = index.get(r.t);
    const s = byKey.get(r.key);
    if (i !== undefined && s) s.values[i] = r.v;
  }
  if (fill === "carry") {
    for (const s of series) for (let i = 1; i < s.values.length; i++) s.values[i] ??= s.values[i - 1]!;
  }
  return { range, bucket: RANGES[range].bucket, t, series };
}

interface Row {
  t: number;
  v: number;
}

/** Fleet hashrate per coin: per-instance bucket average, summed across instances. */
export async function coinHistory(range: Range): Promise<SeriesSet> {
  const { sec, bucket } = RANGES[range];
  const { rows } = await db().query<Row & { coin: string }>(
    `WITH b AS (
       SELECT date_bin(make_interval(secs => $1), ts, timestamptz 'epoch') AS t, coin, rig, source, avg(h60) AS hr
         FROM samples WHERE ts >= now() - make_interval(secs => $2)
        GROUP BY 1, 2, 3, 4)
     SELECT extract(epoch FROM t)::float8 AS t, coin, sum(hr)::float8 AS v FROM b GROUP BY 1, 2 ORDER BY 1`,
    [bucket, sec + bucket],
  );
  const meta = new Map(COIN_IDS.map((c) => [c, { key: c, label: c, coin: c }]));
  return align(range, rows.map((r) => ({ t: r.t, key: r.coin, v: r.v })), meta, "zero");
}

/** Hashrate per miner instance (rig/source); gaps where the instance did not report. */
export async function minerHistory(range: Range): Promise<SeriesSet> {
  const { sec, bucket } = RANGES[range];
  const { rows } = await db().query<Row & { rig: string; source: string; coin: string }>(
    `SELECT extract(epoch FROM date_bin(make_interval(secs => $1), ts, timestamptz 'epoch'))::float8 AS t,
            rig, source, coin, avg(h60)::float8 AS v
       FROM samples WHERE ts >= now() - make_interval(secs => $2)
      GROUP BY 1, 2, 3, 4 ORDER BY 1`,
    [bucket, sec + bucket],
  );
  const meta = new Map<string, Omit<Series, "values">>();
  for (const r of rows) {
    const key = `${r.rig}/${r.source}`;
    const coin = (SOURCES[r.source as Source]?.coin ?? r.coin) as Coin;
    if (!meta.has(key)) meta.set(key, { key, label: `${r.rig} · ${coin}`, coin });
  }
  const sorted = new Map([...meta.entries()].sort(([a, x], [b, y]) => a.split("/")[0]!.localeCompare(b.split("/")[0]!) || COIN_IDS.indexOf(x.coin) - COIN_IDS.indexOf(y.coin)));
  return align(range, rows.map((r) => ({ t: r.t, key: `${r.rig}/${r.source}`, v: r.v })), sorted, "gap");
}

/** Total wallet balance per coin (each wallet de-duplicated across reporters), carried forward. */
export async function walletHistory(range: Range): Promise<SeriesSet> {
  const { sec, bucket } = RANGES[range];
  const { rows } = await db().query<Row & { coin: string }>(
    `WITH b AS (
       SELECT date_bin(make_interval(secs => $1), ts, timestamptz 'epoch') AS t, coin, address, max(balance) AS bal
         FROM wallet_samples WHERE ts >= now() - make_interval(secs => $2)
        GROUP BY 1, 2, 3)
     SELECT extract(epoch FROM t)::float8 AS t, coin, sum(bal)::float8 AS v FROM b GROUP BY 1, 2 ORDER BY 1`,
    [bucket, sec + bucket],
  );
  const present = new Set(rows.map((r) => r.coin));
  const meta = new Map(COIN_IDS.filter((c) => present.has(c)).map((c) => [c, { key: c, label: c, coin: c }]));
  return align(range, rows.map((r) => ({ t: r.t, key: r.coin, v: r.v })), meta, "carry");
}

export const HISTORY = { coins: coinHistory, miners: minerHistory, wallets: walletHistory } as const;
export type HistoryKind = keyof typeof HISTORY;
