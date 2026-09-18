import { interpretationCacheKey, readInterpretationCache, writeInterpretationCache } from "@/lib/interpretation-cache";
import { turnstileSiteKey, verifyTurnstile, VerificationError } from "@/lib/turnstile";
import { database, runtime } from "@/db/client";
import { dailyLimit, quotaIdentity, readUsage, reserveDescription, type Usage } from "@/lib/quota";
import {
  QUESTIONS,
  parseInterpretation,
} from "@/lib/semantic";
function apiKey() {
  return (
    runtime().TYPESAFE_API_KEY ||
    process.env.TYPESAFE_API_KEY
  );
}
function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "private, no-store");
  return Response.json(value, {
    status,
    headers: responseHeaders,
  });
}
function crossSite(request: Request) {
  const origin = request.headers.get("origin");
  return (origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site";
}
function quotaUnavailable() {
  return json({ error: "The daily allowance could not be checked. Please try again shortly; your sound and controls still work." }, 503);
}
export async function GET(request: Request) {
  if (crossSite(request)) return json({ error: "Please use the synthesiser on this site." }, 403);
  try {
    const siteKey = turnstileSiteKey(runtime());
    const db = database();
    const identity = await quotaIdentity(db, request, { create: true });
    const usage = await readUsage(db, identity!, dailyLimit(runtime().TYPESAFE_DAILY_LIMIT));
    return json({ configured: !!apiKey(), usage, turnstileSiteKey: siteKey, ...(identity?.sessionToken ? { sessionToken: identity.sessionToken } : {}) }, 200, identity?.cookie ? { "Set-Cookie": identity.cookie } : {});
  } catch (error) {
    if (error instanceof VerificationError) return json({ error: error.message }, error.status);
    console.error("Daily allowance status unavailable");
    return quotaUnavailable();
  }
}
export async function POST(request: Request) {
  if (crossSite(request))
    return json({ error: "Please use the synthesiser on this site." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Expected a sound description." }, 415);
  let brief: string;
  let verification: unknown;
  try {
    const body = await request.text();
    if (body.length > 8192)
      return json({ error: "Keep the description under 400 characters." }, 413);
    const data = JSON.parse(body);
    verification = data.turnstileToken;
    brief = typeof data.description === "string" ? data.description.trim() : "";
  } catch {
    return json({ error: "Could not read that description." }, 400);
  }
  if (!brief || brief.length > 400)
    return json(
      { error: "Write a description between 1 and 400 characters." },
      400,
    );
  const key = apiKey();
  if (!key)
    return json(
      {
        error:
          "TypeSafe is not connected. Add TYPESAFE_API_KEY to the server environment. You can still play the initial patch and move the controls.",
      },
      503,
    );
  let usage: Usage;
  try {
    const db = database();
    const identity = await quotaIdentity(db, request, { create: false });
    if (!identity) return json({ error: "Your browser session expired. Please reconnect and try again.", code: "SESSION_REQUIRED" }, 401);
    await verifyTurnstile(runtime(), request, verification);
    const reserved = await reserveDescription(db, identity, dailyLimit(runtime().TYPESAFE_DAILY_LIMIT));
    usage = reserved.usage;
    if (!reserved.allowed) return json({
      code: "DAILY_LIMIT",
      error: `You've used today's ${usage.limit} descriptions. Your allowance resets at 00:00 UTC. Keep playing or adjust the controls.`,
      usage,
    }, 429, { "Retry-After": String(Math.max(1, Math.ceil((Date.parse(usage.resetsAt) - Date.now()) / 1000))) });
  } catch (error) {
    if (error instanceof VerificationError) return json({ error: error.message, code: "BROWSER_CHECK" }, error.status);
    console.error("Daily allowance reservation unavailable");
    return quotaUnavailable();
  }
  const reply = (value: object, status = 200) => json({ ...value, usage }, status);
  const cacheKey = await interpretationCacheKey(request.url, brief);
  const cached = await readInterpretationCache(cacheKey);
  if (cached) return reply({ ...cached, cached: true });
  const start = Date.now();
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "jev-latest",
          state: { brief },
          questions: QUESTIONS,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (
        (response.status === 429 || response.status === 529) &&
        attempt === 0
      ) {
        await new Promise((resolve) => setTimeout(resolve, 650));
        continue;
      }
      break;
    }
    if (!response?.ok) {
      const status = response?.status;
      if (status === 401 || status === 403)
        return reply(
          {
            error:
              "TypeSafe rejected the server key. Check its access in your TypeSafe account.",
          },
          502,
        );
      if (status === 429 || status === 529)
        return reply(
          { error: "TypeSafe is busy. Give it a moment, then try again." },
          503,
        );
      return reply(
        {
          error: `TypeSafe could not interpret that description (${status ?? "connection error"}). Your current sound is unchanged.`,
        },
        502,
      );
    }
    const result = parseInterpretation(
      await response.json(),
      Date.now() - start,
    );
    await writeInterpretationCache(cacheKey, result);
    return reply(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    )
      return reply(
        {
          error:
            "TypeSafe took too long. Your sound is still playing; try again.",
        },
        504,
      );
    return reply(
      {
        error:
          "Could not connect to TypeSafe or read its response. Your current sound is unchanged.",
      },
      502,
    );
  }
}
