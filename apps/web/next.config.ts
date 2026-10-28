import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// In dev, share the monorepo root .env with the collector (DATABASE_URL, JWT_SECRET).
const rootEnv = path.join(root, ".env");
if (process.env.NODE_ENV !== "production" && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  turbopack: { root },
  serverExternalPackages: ["argon2", "pg"],
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
