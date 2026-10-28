import { JWT_AUDIENCE, JWT_ISSUER, SESSION_COOKIE, readCookie } from "@fleetboard/shared";
import type { FastifyRequest } from "fastify";
import { jwtVerify } from "jose";

/**
 * /ws/ui gate: the upgrade request must carry the web app's session cookie,
 * signed with the shared JWT_SECRET, and the first-run change must be done.
 */
export function uiAuthorizer(jwtSecret: string) {
  const key = new TextEncoder().encode(jwtSecret);
  return async (req: FastifyRequest): Promise<boolean> => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) return false;
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
      return typeof payload.sub === "string" && payload.mc !== true;
    } catch {
      return false;
    }
  };
}
