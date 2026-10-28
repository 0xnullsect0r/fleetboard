import { z } from "zod";

const EnvSchema = z.object({
  TOKEN: z.string().min(16, "TOKEN must be at least 16 characters (openssl rand -hex 32)"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters (openssl rand -hex 32)"),
  DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DIFF_NODE: z.string().default("xmr.support:18081"),
  XEL_NODE: z.string().default("https://node.xelis.io/json_rpc"),
  /** Set to "0" to skip price/difficulty polling (offline dev). */
  MARKET: z.enum(["0", "1"]).default("1"),
  XMR_WALLET_RPC: z.string().optional(),
  XEL_WALLET_RPC: z.string().optional(),
  XEL_WALLET_USER: z.string().optional(),
  XEL_WALLET_PASS: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`invalid collector environment:\n${issues}`);
  }
  return parsed.data;
}
