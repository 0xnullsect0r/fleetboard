import "server-only";
import type { SessionClaims } from "@fleetboard/shared";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, signSession, sessionCookie, verifySession } from "@/lib/jwt";

export async function getSession(): Promise<SessionClaims | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** For route handlers: a fully set-up session, or a 401/403 response. */
export async function requireSession(): Promise<SessionClaims | NextResponse> {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (s.mc) return NextResponse.json({ error: "credential change required" }, { status: 403 });
  return s;
}

export async function issueSession(res: NextResponse, email: string, mustChange: boolean): Promise<NextResponse> {
  res.cookies.set(sessionCookie(await signSession(email, mustChange)));
  return res;
}
