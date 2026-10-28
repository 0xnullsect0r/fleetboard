import { JWT_AUDIENCE, JWT_ISSUER, SESSION_COOKIE } from "@fleetboard/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { uiAuthorizer } from "../src/auth.js";
import { buildServer } from "../src/server.js";
import { FleetState } from "../src/state.js";
import { TOKEN, stubMarket } from "./helpers.js";

const SECRET = "test-jwt-secret-0123456789abcdef0123456789";
let app: FastifyInstance;
let url: string;

const sign = (mc: boolean, secret = SECRET) =>
  new SignJWT({ mc })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("ops@example.com")
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));

/** Resolves "open" or the HTTP status the upgrade was refused with. */
function attempt(cookie?: string): Promise<string | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, cookie ? { headers: { cookie } } : {});
    ws.on("open", () => {
      ws.close();
      resolve("open");
    });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("error", () => {});
  });
}

beforeAll(async () => {
  app = await buildServer({
    token: TOKEN,
    state: new FleetState(await stubMarket()),
    logLevel: "silent",
    authorizeUi: uiAuthorizer(SECRET),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  url = `ws://127.0.0.1:${addr.port}/ws/ui`;
});
afterAll(() => app.close());

describe("/ws/ui auth", () => {
  it("rejects an upgrade without a session cookie", async () => {
    expect(await attempt()).toBe(401);
  });
  it("accepts a valid session", async () => {
    expect(await attempt(`theme=dark; ${SESSION_COOKIE}=${await sign(false)}`)).toBe("open");
  });
  it("rejects a session that still has to change the default credential", async () => {
    expect(await attempt(`${SESSION_COOKIE}=${await sign(true)}`)).toBe(401);
  });
  it("rejects a token signed with another secret", async () => {
    expect(await attempt(`${SESSION_COOKIE}=${await sign(false, "x".repeat(40))}`)).toBe(401);
  });
});
