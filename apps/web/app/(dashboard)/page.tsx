import { COIN_IDS } from "@fleetboard/shared";
import { LiveConsole } from "@/components/LiveConsole";
import { coinHistory } from "@/lib/history";
import type { Trace } from "@/lib/useSnapshot";

export const dynamic = "force-dynamic";

/** Last 15 minutes of fleet hashrate so the sparklines are not empty on load. */
async function seedTrace(): Promise<Trace | undefined> {
  if (!process.env.DATABASE_URL) return undefined;
  try {
    const h = await coinHistory("15m");
    const trace = {} as Trace;
    for (const c of COIN_IDS) {
      const s = h.series.find((x) => x.coin === c);
      // Drop the in-progress bucket; live samples cover it.
      trace[c] = [h.t.slice(0, -1), (s?.values ?? []).slice(0, -1).map((v) => v ?? 0)];
    }
    return trace;
  } catch {
    return undefined;
  }
}

export default async function DashboardPage() {
  return <LiveConsole seed={await seedTrace()} />;
}
