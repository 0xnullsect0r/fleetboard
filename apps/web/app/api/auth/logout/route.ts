import { NextResponse } from "next/server";
import { sessionCookie } from "@/lib/jwt";

export const runtime = "nodejs";

/** Clears the session. Form posts get a redirect to /login; fetch callers get JSON. */
export async function POST(req: Request) {
  const wantsJson = req.headers.get("accept")?.includes("application/json");
  const res = wantsJson ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(sessionCookie("", 0));
  return res;
}
