import { readFile, readdir } from "node:fs/promises";
import argon2 from "argon2";
import pg from "pg";
import { COIN_IDS, SOURCE_IDS, type Coin, type Source } from "@fleetboard/shared";
import type { FleetState, IngestEvent } from "./state.js";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);
/** Arbitrary constant: serializes concurrent collector boots during migrations. */
const MIGRATION_LOCK = 4_242_001;

export const SAMPLE_EVERY_MS = 15_000;
export const WALLET_SAMPLE_EVERY_MS = 300_000;
export const DEFAULT_EMAIL = "Admin@example.com";
export const DEFAULT_PASSWORD = "Admin";

export function createPool(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  pool.on("error", () => {
    // Idle client errors (db restart) are surfaced by the next query instead.
  });
  return pool;
}

/** Apply every migrations/NNN_*.sql not yet recorded, each in its own transaction. */
export async function migrate(pool: pg.Pool, log: (m: string) => void = () => {}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(new URL(f, MIGRATIONS_DIR), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        log(`migration applied: ${f}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${f} failed: ${String(e)}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}

/** First boot: the only account is Admin@example.com / "Admin", forced to change on login. */
export async function seedUser(pool: pg.Pool): Promise<boolean> {
  const hash = await argon2.hash(DEFAULT_PASSWORD, { type: argon2.argon2id });
  const res = await pool.query(
    "INSERT INTO app_user (id, email, pass_hash, must_change) VALUES (1, $1, $2, true) ON CONFLICT (id) DO NOTHING",
    [DEFAULT_EMAIL, hash],
  );
  return (res.rowCount ?? 0) > 0;
}

const isCoin = (c: string): c is Coin => (COIN_IDS as readonly string[]).includes(c);
const isSource = (s: string): s is Source => (SOURCE_IDS as readonly string[]).includes(s);

/** Reload the known fleet and last wallet balances so a restart shows everything, marked stale. */
export async function restoreState(pool: pg.Pool, state: FleetState): Promise<void> {
  const miners = await pool.query<{ rig: string; source: string; coin: string; last_seen: Date }>(
    "SELECT rig, source, coin, last_seen FROM miners",
  );
  state.restoreKnown(
    miners.rows.flatMap((r) =>
      isSource(r.source) && isCoin(r.coin)
        ? [{ rig: r.rig, source: r.source, coin: r.coin, lastSeen: r.last_seen.getTime() }]
        : [],
    ),
  );
  const wallets = await pool.query<{
    ts: Date;
    coin: string;
    address: string;
    reporter: string;
    balance: number;
    unlocked: number | null;
  }>(
    `SELECT DISTINCT ON (coin, address, reporter) ts, coin, address, reporter, balance, unlocked
       FROM wallet_samples ORDER BY coin, address, reporter, ts DESC`,
  );
  for (const w of wallets.rows) {
    if (!isCoin(w.coin)) continue;
    state.ingestWallets(
      w.reporter,
      [{ coin: w.coin, address: w.address, balance: w.balance, ...(w.unlocked !== null ? { unlocked: w.unlocked } : {}) }],
      w.ts.getTime(),
    );
  }
}

/**
 * Persists ingest events: registry upserts on every report, hashrate samples
 * at most every 15s per instance, wallet balances every 5 min per wallet.
 */
export class SampleWriter {
  private readonly lastSample = new Map<string, number>();
  private readonly lastWallet = new Map<string, number>();
  private readonly lastSeenWrite = new Map<string, number>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly log: (m: string) => void = () => {},
  ) {}

  handle(ev: IngestEvent): void {
    this.write(ev).catch((e: unknown) => this.log(`db write failed: ${String(e)}`));
  }

  /** Wallets polled by the collector itself (server-side wallet RPCs). */
  handleWallets(reporter: string, wallets: IngestEvent["wallets"], now = Date.now()): void {
    this.write({ rig: reporter, now, reported: [], wallets }, false).catch((e: unknown) =>
      this.log(`db write failed: ${String(e)}`),
    );
  }

  private due(map: Map<string, number>, key: string, now: number, every: number): boolean {
    const last = map.get(key);
    if (last !== undefined && now - last < every) return false;
    map.set(key, now);
    return true;
  }

  private async write(ev: IngestEvent, isRig = true): Promise<void> {
    const ts = new Date(ev.now);
    // Registry: last_seen at sample cadence is plenty; first report always writes.
    if (isRig && ev.reported.length && this.due(this.lastSeenWrite, ev.rig, ev.now, SAMPLE_EVERY_MS)) {
      await this.pool.query(
        `INSERT INTO rigs (name, first_seen, last_seen) VALUES ($1, $2, $2)
           ON CONFLICT (name) DO UPDATE SET last_seen = EXCLUDED.last_seen`,
        [ev.rig, ts],
      );
      for (const m of ev.reported) {
        await this.pool.query(
          `INSERT INTO miners (rig, source, coin, first_seen, last_seen) VALUES ($1, $2, $3, $4, $4)
             ON CONFLICT (rig, source) DO UPDATE SET coin = EXCLUDED.coin, last_seen = EXCLUDED.last_seen`,
          [ev.rig, m.source, m.coin, ts],
        );
      }
    }
    for (const m of ev.reported) {
      if (!this.due(this.lastSample, `${ev.rig}/${m.source}`, ev.now, SAMPLE_EVERY_MS)) continue;
      const s = m.summary;
      await this.pool.query(
        `INSERT INTO samples (ts, rig, source, coin, h10, h60, h15, good, rejected)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [ts, ev.rig, m.source, m.coin, s.h10, s.h60, s.h15, s.sharesGood, s.sharesRejected],
      );
    }
    for (const w of ev.wallets) {
      if (!this.due(this.lastWallet, `${w.coin}/${w.address}/${ev.rig}`, ev.now, WALLET_SAMPLE_EVERY_MS)) continue;
      await this.pool.query(
        `INSERT INTO wallet_samples (ts, coin, address, reporter, balance, unlocked) VALUES ($1, $2, $3, $4, $5, $6)`,
        [ts, w.coin, w.address, ev.rig, w.balance, w.unlocked ?? null],
      );
    }
  }
}

/** Drop history older than `days` (hashrate samples only; wallet history is small). */
export async function pruneSamples(pool: pg.Pool, days: number): Promise<number> {
  const res = await pool.query("DELETE FROM samples WHERE ts < now() - make_interval(days => $1)", [days]);
  return res.rowCount ?? 0;
}
