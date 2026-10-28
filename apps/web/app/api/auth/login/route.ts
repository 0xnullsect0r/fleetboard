import { NextResponse } from "next/server";
import { z } from "zod";
import { issueSession } from "@/lib/session";
import { allowAttempt, checkPassword, getUser } from "@/lib/user";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().trim().min(1).max(254), password: z.string().min(1).max(1024) });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowAttempt(ip)) return NextResponse.json({ error: "Too many attempts. Wait a few minutes." }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });

  const user = await getUser();
  const ok =
    user !== null &&
    user.email.toLowerCase() === parsed.data.email.toLowerCase() &&
    (await checkPassword(user, parsed.data.password));
  if (!ok || !user) return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });

  return issueSession(NextResponse.json({ mustChange: user.must_change }), user.email, user.must_change);
}
