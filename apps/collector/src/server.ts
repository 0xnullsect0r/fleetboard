import { timingSafeEqual } from "node:crypto";
import websocket from "@fastify/websocket";
import { AgentMessageSchema, type Snapshot } from "@fleetboard/shared";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { FleetState, IngestEvent } from "./state.js";

/** WebSocket close codes sent to agents. */
export const CLOSE_BAD_TOKEN = 4001;
export const CLOSE_BAD_PAYLOAD = 4002;

const REBROADCAST_MS = 3000;
const BROADCAST_DEBOUNCE_MS = 200;

export interface ServerOptions {
  token: string;
  state: FleetState;
  logLevel?: string;
  /** Gate for /ws/ui upgrades; resolve false to reject with 401. */
  authorizeUi?: (req: FastifyRequest) => Promise<boolean>;
  /** Called after every accepted agent message (DB writes). */
  onIngest?: (ev: IngestEvent) => void;
  /** Extra readiness check for /healthz (e.g. DB ping). */
  healthCheck?: () => Promise<void>;
}

function tokenMatches(expected: Buffer, given: string): boolean {
  const g = Buffer.from(given);
  return g.length === expected.length && timingSafeEqual(g, expected);
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: opts.logLevel ?? "info" }, trustProxy: true });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const expectedToken = Buffer.from(opts.token);
  const uiClients = new Set<WebSocket>();
  let pending: NodeJS.Timeout | undefined;

  const send = (ws: WebSocket, snap: Snapshot | string) => {
    if (ws.readyState === ws.OPEN) ws.send(typeof snap === "string" ? snap : JSON.stringify(snap));
  };
  const broadcastNow = () => {
    pending = undefined;
    if (uiClients.size === 0) return;
    const payload = JSON.stringify(opts.state.snapshot());
    for (const ws of uiClients) send(ws, payload);
  };
  const broadcastSoon = () => {
    pending ??= setTimeout(broadcastNow, BROADCAST_DEBOUNCE_MS);
  };
  const ticker = setInterval(broadcastNow, REBROADCAST_MS);
  app.addHook("onClose", async () => {
    clearInterval(ticker);
    if (pending) clearTimeout(pending);
  });

  app.get("/healthz", async (_req, reply) => {
    try {
      await opts.healthCheck?.();
      return { ok: true };
    } catch (e) {
      return reply.code(503).send({ ok: false, error: String(e) });
    }
  });

  app.get("/ws/agent", { websocket: true }, (socket, req) => {
    let rig: string | undefined;
    socket.on("message", (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        socket.close(CLOSE_BAD_PAYLOAD, "invalid json");
        return;
      }
      const parsed = AgentMessageSchema.safeParse(json);
      if (!parsed.success) {
        req.log.warn({ issues: parsed.error.issues.slice(0, 3) }, "agent payload rejected");
        socket.close(CLOSE_BAD_PAYLOAD, "invalid payload");
        return;
      }
      if (!tokenMatches(expectedToken, parsed.data.token)) {
        req.log.warn({ name: parsed.data.name, ip: req.ip }, "agent token rejected");
        socket.close(CLOSE_BAD_TOKEN, "bad token");
        return;
      }
      if (rig !== parsed.data.name) {
        rig = parsed.data.name;
        req.log.info({ rig, ip: req.ip }, "agent connected");
      }
      const ev = opts.state.ingest(parsed.data);
      opts.onIngest?.(ev);
      broadcastSoon();
    });
    socket.on("close", (code) => {
      if (rig) req.log.info({ rig, code }, "agent disconnected");
    });
  });

  app.get(
    "/ws/ui",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        if (opts.authorizeUi && !(await opts.authorizeUi(req))) {
          await reply.code(401).send({ error: "unauthorized" });
        }
      },
    },
    (socket) => {
      uiClients.add(socket);
      send(socket, opts.state.snapshot());
      socket.on("close", () => uiClients.delete(socket));
    },
  );

  return app;
}
