import "server-only";
import argon2 from "argon2";
import { db } from "@/lib/db";

export interface UserRow {
  email: string;
  pass_hash: string;
  must_change: boolean;
}

export async function getUser(): Promise<UserRow | null> {
  const { rows } = await db().query<UserRow>("SELECT email, pass_hash, must_change FROM app_user WHERE id = 1");
  return rows[0] ?? null;
}

export async function checkPassword(user: UserRow, password: string): Promise<boolean> {
  try {
    return await argon2.verify(user.pass_hash, password);
  } catch {
    return false;
  }
}

export async function setCredentials(email: string, password: string): Promise<void> {
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  await db().query("UPDATE app_user SET email = $1, pass_hash = $2, must_change = false, updated_at = now() WHERE id = 1", [
    email,
    hash,
  ]);
}

/** Minimal fixed-window limiter for login attempts, per client address. */
const attempts = new Map<string, { n: number; reset: number }>();
export function allowAttempt(key: string, max = 8, windowMs = 5 * 60_000): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  a.n++;
  return a.n <= max;
}
