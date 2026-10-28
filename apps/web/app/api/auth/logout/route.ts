import { NextResponse } from "next/server";
import { sessionCookie } from "@/lib/jwt";

export const runtime = "nodejs";

/**
 * Clears the session. Form posts get a redirect to /login; fetch callers get JSON.
 * The Location is relative: behind Caddy or another proxy, req.url is the
 * container's internal address, not the one the browser used.
 */
export async function POST(req: Request) {
  const wantsJson = req.headers.get("accept")?.includes("application/json");
  const res = wantsJson
    ? NextResponse.json({ ok: true })
    : new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  res.cookies.set(sessionCookie("", 0));
  return res;
}
