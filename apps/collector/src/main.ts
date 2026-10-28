import { readWallets, walletEndpointsFromEnv } from "@fleetboard/shared";
import { SampleWriter, createPool, migrate, pruneSamples, restoreState, seedUser } from "./db.js";
import { loadEnv } from "./env.js";
import { Market, liveSources } from "./market.js";
import { buildServer } from "./server.js";
import { FleetState } from "./state.js";

const MARKET_INTERVAL_MS = 180_000;
const WALLET_INTERVAL_MS = 60_000;
const PRUNE_INTERVAL_MS = 3_600_000;

async function main() {
  const env = loadEnv();
  const timers: NodeJS.Timeout[] = [];
  const logLater: string[] = [];
  const log = (m: string) => logLater.push(m);

  const market = new Market(liveSources({ diffNode: env.DIFF_NODE, xelNode: env.XEL_NODE }), (m) => app.log.warn(m));
  const state = new FleetState(market);

  const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined;
  let writer: SampleWriter | undefined;
  if (pool) {
    await migrate(pool, log);
    if (await seedUser(pool)) log("seeded default user Admin@example.com (must change on first login)");
    await restoreState(pool, state);
    writer = new SampleWriter(pool, (m) => app.log.error(m));
  }

  const app = await buildServer({
    token: env.TOKEN,
    state,
    logLevel: env.LOG_LEVEL,
    ...(writer ? { onIngest: (ev) => writer.handle(ev) } : {}),
    ...(pool ? { healthCheck: async () => void (await pool.query("SELECT 1")) } : {}),
  });
  logLater.forEach((m) => app.log.info(m));
  if (!pool) app.log.warn("DATABASE_URL not set: running in-memory, no history");

  if (env.MARKET === "1") {
    const refresh = () =>
      market.refresh().then(() => app.log.info({ XMR: market.get("XMR"), XEL: market.get("XEL") }, "market refreshed"));
    void refresh();
    timers.push(setInterval(refresh, MARKET_INTERVAL_MS));
  }

  // Wallets co-hosted with the server (compose profile "wallets") report as "server".
  const walletEps = walletEndpointsFromEnv(env);
  if (walletEps.length) {
    const poll = async () => {
      const reports = await readWallets(walletEps);
      if (reports.length < walletEps.length) app.log.warn(`server wallets: ${reports.length}/${walletEps.length} answered`);
      state.ingestWallets("server", reports);
      writer?.handleWallets("server", reports);
    };
    void poll();
    timers.push(setInterval(poll, WALLET_INTERVAL_MS));
  }

  if (pool) {
    const prune = () =>
      pruneSamples(pool, env.HISTORY_DAYS).then(
        (n) => n && app.log.info(`pruned ${n} samples older than ${env.HISTORY_DAYS}d`),
        (e: unknown) => app.log.error(`prune failed: ${String(e)}`),
      );
    timers.push(setInterval(prune, PRUNE_INTERVAL_MS));
  }

  const shutdown = async () => {
    timers.forEach(clearInterval);
    await app.close();
    await pool?.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
