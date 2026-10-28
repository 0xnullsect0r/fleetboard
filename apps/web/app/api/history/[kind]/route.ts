import { HISTORY, isRange, type HistoryKind } from "@/lib/history";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const session = await requireSession();
  if (session instanceof Response) return session;
  const { kind } = await ctx.params;
  if (!(kind in HISTORY)) return Response.json({ error: "unknown history kind" }, { status: 404 });
  const range = new URL(req.url).searchParams.get("range") ?? "24h";
  if (!isRange(range)) return Response.json({ error: "range must be one of 15m, 1h, 6h, 24h, 7d, 30d" }, { status: 400 });
  try {
    return Response.json(await HISTORY[kind as HistoryKind](range));
  } catch (e) {
    console.error("history query failed", e);
    return Response.json({ error: "history unavailable" }, { status: 503 });
  }
}
