import type { Snapshot } from "@fleetboard/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSE_BAD_TOKEN, buildServer } from "../src/server.js";
import { FleetState } from "../src/state.js";
import { MARKET, TOKEN, coinDay, pcMessage, stubMarket } from "./helpers.js";

let app: FastifyInstance;
let base: string;

beforeAll(async () => {
  const state = new FleetState(await stubMarket());
  app = await buildServer({ token: TOKEN, state, logLevel: "silent" });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  base = `ws://127.0.0.1:${addr.port}`;
});

afterAll(() => app.close());

function open(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base + path);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`ws ${path} failed`));
  });
}

function nextSnapshot(ws: WebSocket, pred: (s: Snapshot) => boolean): Promise<Snapshot> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (ev) => {
      const s = JSON.parse(String(ev.data)) as Snapshot;
      if (pred(s)) resolve(s);
    });
  });
}

describe("collector", () => {
  it("serves /healthz", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.json()).toEqual({ ok: true });
  });

  it("aggregates an XMR+XEL agent message per coin", async () => {
    const ui = await open("/ws/ui");
    const got = nextSnapshot(ui, (s) => s.miners.length === 2);
    const agent = await open("/ws/agent");
    agent.send(JSON.stringify(pcMessage()));
    const snap = await got;

    expect(snap.miners.map((m) => `${m.rig}/${m.coin}/${m.status}`)).toEqual(["pc/XMR/up", "pc/XEL/up"]);
    expect(snap.coins.XMR.totalHr).toBe(12_000);
    expect(snap.coins.XEL.totalHr).toBe(2e6);

    const xmrDay = coinDay(12_000, "XMR");
    const xelDay = coinDay(2e6, "XEL");
    expect(snap.coins.XMR.earnings?.coinDay).toBeCloseTo(xmrDay, 12);
    expect(snap.coins.XEL.earnings?.coinDay).toBeCloseTo(xelDay, 12);
    const usdDay = xmrDay * MARKET.XMR.price + xelDay * MARKET.XEL.price;
    expect(snap.usdDayTotal).toBeCloseTo(usdDay, 10);
    expect(snap.usdWeekTotal).toBeCloseTo(usdDay * 7, 10);
    expect(snap.usdMonthTotal).toBeCloseTo(usdDay * 30, 10);
    expect(snap.coins.XMR.price).toBe(MARKET.XMR.price);

    agent.close();
    ui.close();
  });

  it("closes agents with a bad token using 4001", async () => {
    const agent = await open("/ws/agent");
    const closed = new Promise<number>((r) => (agent.onclose = (ev) => r(ev.code)));
    agent.send(JSON.stringify(pcMessage({ token: "wrong-token-wrong-token" })));
    expect(await closed).toBe(CLOSE_BAD_TOKEN);
  });
});
