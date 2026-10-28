/**
 * Simulates the fleet against a collector: one WebSocket per rig, the same
 * AgentMessage an agent would send every 5s.
 *
 *   pnpm --filter @fleetboard/collector fake-agent -- [--url ws://127.0.0.1:4000/ws/agent]
 *     [--token $TOKEN] [--rigs pc,laptop] [--interval 5] [--wallets] [--idle laptop]
 *
 * --idle <rigs>  those rigs alternate between mining and idle every minute,
 *                like a gaming PC, sending the goodbye message when idle.
 */
import { parseArgs } from "node:util";
import type { AgentMessage, MinerReport, Source, WalletReport } from "@fleetboard/shared";
import { SOURCES } from "@fleetboard/shared";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "ws://127.0.0.1:4000/ws/agent" },
    token: { type: "string", default: process.env.TOKEN ?? "" },
    rigs: { type: "string" },
    interval: { type: "string", default: "5" },
    wallets: { type: "boolean", default: false },
    idle: { type: "string", default: "" },
  },
});

interface RigSpec {
  name: string;
  miners: Partial<Record<Source, { hr: number; device: string }>>;
}

const FLEET: RigSpec[] = [
  { name: "garuda-pc", miners: { xmrig: { hr: 18_500, device: "AMD Ryzen 9 7950X 16-Core" }, srbminer: { hr: 52_000, device: "AMD Radeon RX 7900 XT" } } },
  { name: "garuda-laptop", miners: { xmrig: { hr: 6_100, device: "AMD Ryzen 7 6800H" }, srbminer: { hr: 18_500, device: "NVIDIA GeForce RTX 3060 Laptop GPU" } } },
  { name: "mac-m", miners: { xmrig: { hr: 3_200, device: "Apple M2 Pro" } } },
  { name: "mac-intel", miners: { xmrig: { hr: 1_900, device: "Intel Core i7-9750H" } } },
  { name: "proxmox", miners: { xmrig: { hr: 9_800, device: "AMD EPYC 7302P 16-Core" } } },
  { name: "debian-vm1", miners: { xmrig: { hr: 2_400, device: "QEMU Virtual CPU" } } },
  { name: "debian-vm2", miners: { xmrig: { hr: 2_350, device: "QEMU Virtual CPU" } } },
  { name: "debian-vm3", miners: { xmrig: { hr: 2_420, device: "QEMU Virtual CPU" } } },
  { name: "debian-vm4", miners: { xmrig: { hr: 2_380, device: "QEMU Virtual CPU" } } },
];

const pick = values.rigs?.split(",").map((s) => s.trim());
const rigs = pick ? FLEET.filter((r) => pick.includes(r.name)) : FLEET;
const idleRigs = new Set(values.idle.split(",").filter(Boolean));
const intervalMs = Number(values.interval) * 1000;
const jitter = (v: number, pct: number) => v * (1 + (Math.random() * 2 - 1) * pct);

if (!values.token) {
  console.error("missing --token (or TOKEN env)");
  process.exit(1);
}

function runRig(rig: RigSpec) {
  const shares = new Map<Source, { good: number; bad: number }>();
  const h15 = new Map<Source, number>();
  let ws: WebSocket | undefined;
  let backoff = 1000;

  const mining = () => !idleRigs.has(rig.name) || Math.floor(Date.now() / 60_000) % 2 === 0;

  const message = (): AgentMessage => {
    const miners: MinerReport[] = [];
    if (mining()) {
      for (const [source, spec] of Object.entries(rig.miners) as [Source, { hr: number; device: string }][]) {
        const s = shares.get(source) ?? { good: 0, bad: 0 };
        if (Math.random() < 0.3) s.good++;
        if (Math.random() < 0.004) s.bad++;
        shares.set(source, s);
        const slow = (h15.get(source) ?? spec.hr) * 0.98 + jitter(spec.hr, 0.01) * 0.02;
        h15.set(source, slow);
        miners.push({
          source,
          coin: SOURCES[source].coin,
          summary: {
            h10: jitter(spec.hr, 0.06),
            h60: jitter(spec.hr, 0.025),
            h15: slow,
            sharesGood: s.good,
            sharesRejected: s.bad,
            device: spec.device,
          },
        });
      }
    }
    const wallets: WalletReport[] | undefined =
      values.wallets && rig.name === "garuda-pc"
        ? [
            { coin: "XMR", address: "48edfHu7V9Z84YzzMa6fUueoELZ9ZRXq9VetWzYGzKt52XU5xvqgzYnDK9URnRoJMk1j8nLwEVsaSWJ4fhdUyZijBGUicoD", balance: 0.184213, unlocked: 0.171905, viewOnly: true },
            { coin: "XEL", address: "xel:ys4peuzztwl67rzhsdu0yxfzwcfmgt85uu53hycpeeary7n8qvysqmxznt0", balance: 41.7731 },
          ]
        : undefined;
    return { token: values.token!, name: rig.name, ts: Date.now(), miners, ...(wallets ? { wallets } : {}) };
  };

  const connect = () => {
    ws = new WebSocket(values.url);
    ws.onopen = () => {
      backoff = 1000;
      console.log(`[${rig.name}] connected`);
    };
    ws.onclose = (ev) => {
      console.log(`[${rig.name}] closed ${ev.code} ${ev.reason}`);
      if (ev.code === 4001) process.exit(2);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    };
    ws.onerror = () => {};
  };

  connect();
  setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message()));
  }, intervalMs);
}

rigs.forEach(runRig);
console.log(`simulating ${rigs.length} rig(s) -> ${values.url}`);
