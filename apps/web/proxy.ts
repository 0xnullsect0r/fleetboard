import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";

/**
 * Gate every page and API route behind the session JWT, except /login and
 * /api/auth/* (whose handlers enforce their own rules). While the default
 * credential is active (mc), everything funnels to /first-run.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith("/api/");
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));

  if (pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (pathname === "/login") {
    if (session) return to(session.mc ? "/first-run" : "/");
    return NextResponse.next();
  }
  if (!session) {
    if (isApi) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if (session.mc && pathname !== "/first-run") {
    return isApi ? NextResponse.json({ error: "credential change required" }, { status: 403 }) : to("/first-run");
  }
  if (!session.mc && pathname === "/first-run") return to("/");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg).*)"],
};
