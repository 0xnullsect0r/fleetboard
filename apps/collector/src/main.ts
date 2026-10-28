import { readWallets, walletEndpointsFromEnv } from "@fleetboard/shared";
import { loadEnv } from "./env.js";
import { Market, liveSources } from "./market.js";
import { buildServer } from "./server.js";
import { FleetState } from "./state.js";

const MARKET_INTERVAL_MS = 180_000;
const WALLET_INTERVAL_MS = 60_000;

async function main() {
  const env = loadEnv();
  const market = new Market(liveSources({ diffNode: env.DIFF_NODE, xelNode: env.XEL_NODE }), (m) =>
    app.log.warn(m),
  );
  const state = new FleetState(market);
  const app = await buildServer({ token: env.TOKEN, state, logLevel: env.LOG_LEVEL });

  const timers: NodeJS.Timeout[] = [];
  if (env.MARKET === "1") {
    const refresh = () =>
      market.refresh().then(() => {
        const [x, l] = [market.get("XMR"), market.get("XEL")];
        app.log.info({ XMR: x, XEL: l }, "market refreshed");
      });
    void refresh();
    timers.push(setInterval(refresh, MARKET_INTERVAL_MS));
  }

  // Wallets co-hosted with the server (compose profile "wallets") report as rig "server".
  const walletEps = walletEndpointsFromEnv(env);
  if (walletEps.length) {
    const poll = async () => state.ingestWallets("server", await readWallets(walletEps));
    void poll();
    timers.push(setInterval(poll, WALLET_INTERVAL_MS));
  }

  const shutdown = async () => {
    timers.forEach(clearInterval);
    await app.close();
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
