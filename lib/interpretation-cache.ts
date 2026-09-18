import { QUESTIONS, validPatch, type Interpretation } from "./semantic";

export const INTERPRETATION_CACHE_SECONDS = 300;

export async function interpretationCacheKey(origin: string, description: string): Promise<Request> {
  // Changes to the model/questions or cache format naturally invalidate old keys.
  const input = JSON.stringify({ v: 1, model: 'jev-latest', questions: QUESTIONS, description });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return new Request(new URL(`/__sound_result_cache/${hash}`, origin), { method: 'GET' });
}

export async function readInterpretationCache(key: Request): Promise<Interpretation | null> {
  try {
    const response = await (caches as CacheStorage & { default: Cache }).default.match(key);
    if (!response) return null;
    const result = await response.json() as Interpretation;
    return validPatch(result.patch) ? result : null;
  } catch { return null; } // Cache unavailability must not break the instrument.
}

export async function writeInterpretationCache(key: Request, result: Interpretation): Promise<void> {
  try {
    // Cache only the shared model result. The outward API response carries fresh
    // per-browser usage and remains private/no-store. Never cache cookies/tokens.
    await (caches as CacheStorage & { default: Cache }).default.put(key, Response.json(result, {
      headers: { 'Cache-Control': `public, max-age=${INTERPRETATION_CACHE_SECONDS}` },
    }));
  } catch { /* A failed cache write does not discard a successful interpretation. */ }
}
