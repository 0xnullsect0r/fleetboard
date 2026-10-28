import "server-only";
import pg from "pg";

declare global {
  var __fleetPool: pg.Pool | undefined;
}

/** One pool per server process (survives dev hot reloads). */
export function db(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  globalThis.__fleetPool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return globalThis.__fleetPool;
}
