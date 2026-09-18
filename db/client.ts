import { env } from "cloudflare:workers";
import type { TurnstileConfig } from "@/lib/turnstile";
import type { QuotaDatabase } from "@/lib/quota";

type Runtime = TurnstileConfig & { DB?: D1Database; TYPESAFE_API_KEY?: string; TYPESAFE_DAILY_LIMIT?: string };

export function runtime(): Runtime {
  return env as unknown as Runtime;
}

export function database(): QuotaDatabase {
  const db = runtime().DB;
  if (!db) throw new Error("Daily allowance storage is unavailable");
  // Pin reads to the primary too, so UI status never depends on a stale replica.
  return db.withSession("first-primary");
}
