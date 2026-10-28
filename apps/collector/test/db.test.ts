import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SampleWriter, createPool, migrate, restoreState, seedUser } from "../src/db.js";
import { FleetState } from "../src/state.js";
import { pcMessage, stubMarket } from "./helpers.js";

// Opt-in: point at a disposable database, e.g.
//   TEST_DATABASE_URL=postgres://fleetboard:devpass@localhost:55432/fleetboard_test pnpm test
const url = process.env.TEST_DATABASE_URL;
const pool = url ? createPool(url) : undefined;

describe.skipIf(!pool)("postgres", () => {
  beforeAll(async () => {
    await pool!.query(
      "DROP TABLE IF EXISTS schema_migrations, app_user, samples, wallet_samples, miners, rigs CASCADE",
    );
  });
  afterAll(() => pool!.end());

  it("migrates idempotently and seeds exactly one user", async () => {
    await migrate(pool!);
    await migrate(pool!);
    expect(await seedUser(pool!)).toBe(true);
    expect(await seedUser(pool!)).toBe(false);
    const users = await pool!.query("SELECT email, must_change FROM app_user");
    expect(users.rows).toEqual([{ email: "Admin@example.com", must_change: true }]);
    await expect(pool!.query("INSERT INTO app_user (id, email, pass_hash) VALUES (2, 'x', 'y')")).rejects.toThrow();
  });

  it("throttles samples to one per 15s per instance and restores the fleet", async () => {
    const state = new FleetState(await stubMarket());
    const writer = new SampleWriter(pool!);
    const t0 = Date.now() - 60_000;
    const flush = () => new Promise((r) => setTimeout(r, 150));
    writer.handle(state.ingest(pcMessage(), t0));
    await flush();
    writer.handle(state.ingest(pcMessage(), t0 + 5_000));
    await flush();
    writer.handle(state.ingest(pcMessage({ wallets: [{ coin: "XEL", address: "xel:abc", balance: 3 }] }), t0 + 16_000));
    await flush();
    const n = await pool!.query<{ n: string }>("SELECT count(*) AS n FROM samples");
    expect(Number(n.rows[0]!.n)).toBe(4);
    const w = await pool!.query("SELECT coin, reporter, balance FROM wallet_samples");
    expect(w.rows).toEqual([{ coin: "XEL", reporter: "pc", balance: 3 }]);

    const fresh = new FleetState(await stubMarket());
    await restoreState(pool!, fresh);
    const snap = fresh.snapshot();
    expect(snap.miners.map((m) => `${m.rig}/${m.source}/${m.status}`)).toEqual(["pc/xmrig/off", "pc/srbminer/off"]);
    expect(snap.wallets[0]?.balance).toBe(3);
  });
});
