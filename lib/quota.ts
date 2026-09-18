export type Usage = {
  limit: number;
  remaining: number;
  resetsAt: string;
  scope: "browser";
};
export type QuotaDatabase = Pick<D1Database, "prepare" | "batch">;

export type QuotaIdentity = {
  subject: string;
  scope: Usage["scope"];
  cookie?: string;
  sessionToken?: string;
};

const DAY = 86_400_000;
const SESSION_SECONDS = 30 * 24 * 60 * 60;

export function dailyLimit(value?: string): number {
  if (!value) return 50;
  if (!/^(0|[1-9]\d{0,4})$/.test(value) || Number(value) > 10000)
    throw new Error("Invalid TYPESAFE_DAILY_LIMIT");
  return Number(value);
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Allowances belong to a server-issued random token, never a caller-chosen ID.
// Embedded players may return that token explicitly when cookies are blocked.
export async function quotaIdentity(
  db: QuotaDatabase,
  request: Request,
  options: { create: boolean; now?: number },
): Promise<QuotaIdentity | null> {
  const now = options.now ?? Date.now();
  const url = new URL(request.url);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const embedded = request.headers.get("X-Textured-Embed") === "1";
  const cookieName = embedded ? "__Host-textured_embed" : localHttp ? "textured_session" : "__Host-textured_session";
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim());
  const values = cookies.filter((part) => part.startsWith(`${cookieName}=`));
  const cookieToken = values.length === 1 ? values[0].slice(cookieName.length + 1) : "";
  const tokens = [cookieToken, ...(embedded ? [request.headers.get("X-Textured-Session") ?? ""] : [])];
  for (const token of new Set(tokens)) {
    if (!/^[a-f0-9]{64}$/.test(token)) continue;
    const tokenHash = await hash(token);
    const session = await db.prepare(
      "SELECT token_hash FROM browser_sessions WHERE token_hash = ?1 AND expires_at > ?2",
    ).bind(tokenHash, now).first();
    if (session) return { subject: `browser:${tokenHash}`, scope: "browser", ...(embedded ? { sessionToken: token } : {}) };
  }
  if (!options.create) return null;

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const newToken = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const tokenHash = await hash(newToken);
  // Only hashes are stored. Quotas are server-side, never encoded in the cookie.
  await db.batch([
    db.prepare("INSERT INTO browser_sessions (token_hash, expires_at) VALUES (?1, ?2)")
      .bind(tokenHash, now + SESSION_SECONDS * 1000),
    db.prepare("DELETE FROM browser_sessions WHERE expires_at <= ?1").bind(now),
    db.prepare("DELETE FROM daily_usage WHERE day < ?1").bind(new Date(now - 7 * DAY).toISOString().slice(0, 10)),
  ]);
  return {
    subject: `browser:${tokenHash}`,
    scope: "browser",
    ...(embedded ? { sessionToken: newToken } : {}),
    cookie: `${cookieName}=${newToken}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; ${embedded ? "SameSite=None; Secure; Partitioned" : `SameSite=Strict${localHttp ? "" : "; Secure"}`}`,
  };
}

function usage(identity: QuotaIdentity, limit: number, used: number, now: number): Usage {
  return {
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: new Date(Math.floor(now / DAY) * DAY + DAY).toISOString(),
    scope: identity.scope,
  };
}

export async function readUsage(db: QuotaDatabase, identity: QuotaIdentity, limit: number, now = Date.now()): Promise<Usage> {
  const day = new Date(now).toISOString().slice(0, 10);
  const row = await db.prepare("SELECT used FROM daily_usage WHERE subject = ?1 AND day = ?2")
    .bind(identity.subject, day).first<{ used: number }>();
  return usage(identity, limit, row?.used ?? 0, now);
}

export async function reserveDescription(db: QuotaDatabase, identity: QuotaIdentity, limit: number, now = Date.now()): Promise<{ allowed: boolean; usage: Usage }> {
  const day = new Date(now).toISOString().slice(0, 10);
  // One conditional write prevents concurrent requests in different Workers
  // from each claiming the last slot. Reserve before calling the paid upstream.
  const row = await db.prepare(`
    INSERT INTO daily_usage (subject, day, used)
    SELECT ?1, ?2, 1 WHERE ?3 > 0
    ON CONFLICT(subject, day) DO UPDATE SET used = daily_usage.used + 1
    WHERE daily_usage.used < ?3
    RETURNING used
  `).bind(identity.subject, day, limit).first<{ used: number }>();
  return { allowed: !!row, usage: usage(identity, limit, row?.used ?? limit, now) };
}
