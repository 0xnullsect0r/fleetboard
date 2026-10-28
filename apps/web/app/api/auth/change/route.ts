import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, issueSession } from "@/lib/session";
import { checkPassword, getUser, setCredentials } from "@/lib/user";

export const runtime = "nodejs";

const Body = z.object({
  newEmail: z.string().trim().email("Enter a valid email address.").max(254),
  newPassword: z
    .string()
    .min(10, "Password must be at least 10 characters.")
    .max(1024)
    .refine((p) => p.toLowerCase() !== "admin", "Choose a password other than the default."),
  currentPassword: z.string().max(1024).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const user = await getUser();
  if (!user) return NextResponse.json({ error: "account missing" }, { status: 500 });
  // Once first-run is done, a session alone is not enough: a token minted while
  // the default credential was live must not be able to take the account back.
  if (!user.must_change) {
    const current = parsed.data.currentPassword;
    if (!current || !(await checkPassword(user, current))) {
      return NextResponse.json({ error: "Current password is required." }, { status: 403 });
    }
  }

  await setCredentials(parsed.data.newEmail, parsed.data.newPassword);
  return issueSession(NextResponse.json({ ok: true }), parsed.data.newEmail, false);
}
