/** Session cookie + JWT claims shared by web (issuer) and collector (/ws/ui verifier). */
export const SESSION_COOKIE = "fb_session";
export const JWT_ISSUER = "fleetboard";
export const JWT_AUDIENCE = "fleetboard-ui";
export const SESSION_TTL_SEC = 7 * 24 * 3600;

export interface SessionClaims {
  /** Account email. */
  sub: string;
  /** must_change: the default credential is still active. */
  mc: boolean;
}

/** Read one cookie from a raw Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
