import { JWT_AUDIENCE, JWT_ISSUER, SESSION_COOKIE, SESSION_TTL_SEC, type SessionClaims } from "@fleetboard/shared";
import { SignJWT, jwtVerify } from "jose";

export { SESSION_COOKIE };

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET must be set (at least 32 characters)");
  return new TextEncoder().encode(s);
}

export async function signSession(email: string, mustChange: boolean): Promise<string> {
  return new SignJWT({ mc: mustChange })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, mc: payload.mc === true };
  } catch {
    return null;
  }
}

export const sessionCookie = (value: string, maxAge = SESSION_TTL_SEC) => ({
  name: SESSION_COOKIE,
  value,
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge,
});
