/**
 * Fake XMRig (:18088/2/summary) and SRBMiner (:21550) APIs on 127.0.0.1 for
 * exercising the agent end to end.
 *   bun scripts/mock-miners.ts [--only xmrig|srbminer]
 */
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
let good = 0;
const jitter = (v: number) => v * (1 + (Math.random() - 0.5) * 0.05);

if (!only || only === "xmrig") {
  Bun.serve({
    hostname: "127.0.0.1",
    port: 18088,
    fetch(req) {
      if (new URL(req.url).pathname !== "/2/summary") return new Response("not found", { status: 404 });
      good += Math.random() < 0.3 ? 1 : 0;
      return Response.json({
        worker_id: "mock",
        version: "6.24.0",
        cpu: { brand: "AMD Ryzen 9 7950X 16-Core Processor", cores: 16, threads: 32 },
        hashrate: { total: [jitter(18_400), jitter(18_300), 18_250], highest: 19_100 },
        results: { shares_good: good, shares_total: good + 1, diff_current: 120_000 },
      });
    },
  });
  console.log("mock XMRig on http://127.0.0.1:18088/2/summary");
}

if (!only || only === "srbminer") {
  Bun.serve({
    hostname: "127.0.0.1",
    port: 21550,
    fetch() {
      return Response.json({
        miner_version: "2.9.8",
        hashrate_total_now: 52_100,
        algorithms: [
          {
            id: 0,
            name: "xelishashv3",
            hashrate: { gpu: { total: jitter(52_100), "1min": jitter(51_900), "15min": 51_800 }, cpu: { total: 0 } },
            shares: { accepted: good, rejected: 0, total: good },
            pool: { pool: "xel.kryptex.network:7019" },
          },
        ],
        gpu_devices: [{ id: 0, model: "AMD Radeon RX 7900 XT", bus_id: "03:00.0" }],
      });
    },
  });
  console.log("mock SRBMiner on http://127.0.0.1:21550");
}
