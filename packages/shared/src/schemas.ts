import { z } from "zod";
import { COIN_IDS, SOURCE_IDS } from "./coins.js";

const num = z.number().finite();
const count = z.number().int().nonnegative();

export const CoinSchema = z.enum(COIN_IDS);
export const SourceSchema = z.enum(SOURCE_IDS);

/** Hashrates in H/s over the miner's 10s / 60s / 15m windows. */
export const RigSummarySchema = z.object({
  h10: num.nonnegative(),
  h60: num.nonnegative(),
  h15: num.nonnegative(),
  sharesGood: count,
  sharesRejected: count,
  device: z.string().max(200).optional(),
});

export const MinerReportSchema = z.object({
  source: SourceSchema,
  coin: CoinSchema,
  summary: RigSummarySchema,
});

/**
 * Balance read from a wallet RPC on the agent's own host (monero-wallet-rpc,
 * xelis_wallet). Amounts are whole coins, already scaled from atomic units.
 */
export const WalletReportSchema = z.object({
  coin: CoinSchema,
  balance: num.nonnegative(),
  unlocked: num.nonnegative().optional(),
  /** Wallet can only see incoming funds (Monero view-only wallet). */
  viewOnly: z.boolean().optional(),
});

/**
 * One message per agent cycle carrying every local miner that answered.
 * An empty `miners` array means "agent alive, no miner running" and is sent
 * once before the agent closes its socket when the rig stops mining.
 */
export const AgentMessageSchema = z.object({
  token: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "rig name may only contain letters, digits, . _ -"),
  ts: num,
  miners: z.array(MinerReportSchema).max(16),
  wallets: z.array(WalletReportSchema).max(8).optional(),
});

/**
 * up   – reported within STALE_SEC
 * down – agent stopped reporting without saying goodbye (crash, network loss)
 * off  – agent reported this miner is not running (rig powered down mining)
 */
export const MinerStatusSchema = z.enum(["up", "down", "off"]);

export const MinerStateSchema = z.object({
  rig: z.string(),
  source: SourceSchema,
  coin: CoinSchema,
  ok: z.boolean(),
  status: MinerStatusSchema,
  h10: num,
  h60: num,
  h15: num,
  good: count,
  rejected: count,
  device: z.string().optional(),
  /** Seconds since the last report for this instance. */
  age: num,
});

export const WalletStateSchema = z.object({
  rig: z.string(),
  coin: CoinSchema,
  ok: z.boolean(),
  balance: num,
  unlocked: num.optional(),
  viewOnly: z.boolean().optional(),
  usd: num.optional(),
  age: num,
});

export const EarningsSchema = z.object({
  coinDay: num,
  usdDay: num,
  usdWeek: num,
  usdMonth: num,
});

export const CoinAggSchema = z.object({
  coin: CoinSchema,
  totalHr: num,
  price: num.optional(),
  diff: num.optional(),
  reward: num.optional(),
  earnings: EarningsSchema.optional(),
  /** Sum of the last known balance of every wallet for this coin. */
  balance: num.optional(),
  balanceUsd: num.optional(),
});

export const SnapshotSchema = z.object({
  updated: num,
  coins: z.record(CoinSchema, CoinAggSchema),
  miners: z.array(MinerStateSchema),
  wallets: z.array(WalletStateSchema),
  usdDayTotal: num,
  usdWeekTotal: num,
  usdMonthTotal: num,
  balanceUsdTotal: num,
});

export const AuthUserSchema = z.object({
  email: z.string(),
  mustChange: z.boolean(),
});

export type RigSummary = z.infer<typeof RigSummarySchema>;
export type WalletReport = z.infer<typeof WalletReportSchema>;
export type WalletState = z.infer<typeof WalletStateSchema>;
export type MinerReport = z.infer<typeof MinerReportSchema>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type MinerStatus = z.infer<typeof MinerStatusSchema>;
export type MinerState = z.infer<typeof MinerStateSchema>;
export type Earnings = z.infer<typeof EarningsSchema>;
export type CoinAgg = z.infer<typeof CoinAggSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
