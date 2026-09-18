export type TurnstileConfig = {
  TURNSTILE_REQUIRED?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
};

export class VerificationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function turnstileSiteKey(config: TurnstileConfig): string | null {
  if (config.TURNSTILE_REQUIRED !== 'true') return null;
  if (!config.TURNSTILE_SITE_KEY || !config.TURNSTILE_SECRET_KEY)
    throw new VerificationError('Browser verification is temporarily unavailable. Your controls still work.', 503);
  return config.TURNSTILE_SITE_KEY;
}

export async function verifyTurnstile(config: TurnstileConfig, request: Request, token: unknown): Promise<void> {
  if (!turnstileSiteKey(config)) return;
  if (typeof token !== 'string' || !token || token.length > 2048)
    throw new VerificationError('Please complete the browser check and try again.', 403);
  let result: { success?: boolean; hostname?: string; action?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: config.TURNSTILE_SECRET_KEY, response: token }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Verification unavailable');
    result = await response.json();
  } catch {
    throw new VerificationError('The browser check could not connect. Please try again.', 503);
  }
  // Siteverify also enforces one use and a five-minute token lifetime. Never
  // trust client-supplied origin, hostname, action, or success flags instead.
  if (result.success !== true || result.hostname !== new URL(request.url).hostname || result.action !== 'interpret')
    throw new VerificationError('The browser check expired or was not valid. Please try again.', 403);
}
