import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const dailyUsage = sqliteTable("daily_usage", {
  subject: text("subject").notNull(),
  day: text("day").notNull(),
  used: integer("used").notNull(),
}, (table) => [
  primaryKey({ columns: [table.subject, table.day] }),
  index("idx_daily_usage_day").on(table.day),
  check("daily_usage_nonnegative", sql`${table.used} >= 0`),
]);

export const browserSessions = sqliteTable("browser_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("idx_browser_sessions_expiry").on(table.expiresAt)]);
