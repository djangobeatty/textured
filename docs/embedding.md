# Embed Textured

The player is a small iframe on a separate origin. Its Web Audio engine, controls,
sharing and quota display work inside the page. A lightweight script mounts it
where the script tag appears; no framework is needed on the host page.

Once the app is deployed to your Cloudflare Worker, use its real public URL:

```html
<script src="https://YOUR-PLAYER-HOST/embed.js" data-sound="dolphins swimming"></script>
```

The default is **directly in the page**. It fits the available width and adjusts
its height as the controls change. Audio starts only after a visitor presses
Play or Make some noise. The host page's CSS does not style the player.

Optional attributes:

- `data-sound`: prefill the description (up to 400 characters).
- `data-player`: an optional player URL. Defaults to `/` on the script's origin.
- `data-mode="button"`: a button opens a dialog instead of rendering inline.
- `data-label`: the optional launcher button's text.

Place the script in the HTML at the intended position. If installed in the head,
it appends the player to the body once available. Multiple scripts create separate
players. Share this sound produces a link to the containing page's current domain and
path, with **only** the description in `?sound=...`. The host URL's sound parameter
overrides `data-sound`. The loader forwards that description to the player; it
never forwards unrelated query parameters, private fragment data or knob settings.
A custom domain works automatically on the next page load. Old links retain their
old hostname and need a redirect if that hostname is retired.
A stalled frame offers Retry loading in place. The embedded player has its own
Share this sound button beside Step 1. Closing the optional dialog pauses playback and retains the patch.

## Hosting and security

Host the full app, `/embed.js`, audio assets and `/api/interpret` together on your
Cloudflare Worker. The host page only needs the script tag. Keep `TYPESAFE_API_KEY` as a Worker secret. Bind a D1 database as
`DB`, apply the migrations in `drizzle`, and set `TYPESAFE_DAILY_LIMIT=50`.

The frame sends requests to its own API origin; the parent page does not need
API CORS access. Parent/frame messages verify both source window and exact
origin. They contain readiness, height and pause commands, never credentials.
The loader does not expose a general-purpose API proxy to the parent.

Anonymous embedded sessions use a separate Secure, HttpOnly,
`SameSite=None; Partitioned` cookie. Their daily allowance is per browser token
within the embedding top-level site in supporting browsers. Standalone sessions
keep their Strict cookie and separate allowance. Reloads reuse a valid token;
clearing cookies or obtaining another session can yield another allowance.
If the browser cannot persist the embedded cookie, the player asks the visitor to
allow cookies and retry. Manual controls remain usable.

The iframe is UI isolation, **not API authentication**. A caller can still imitate
requests. The existing atomic D1 daily limit applies in the embed, but bot
screening, session-issuance throttling and an overall paid-call ceiling are
separate controls. The standalone Cloudflare deployment sets
`TURNSTILE_REQUIRED=true`, exposes only `TURNSTILE_SITE_KEY`, and keeps
`TURNSTILE_SECRET_KEY` in Worker secrets. Each interpretation verifies a fresh
Turnstile token with Siteverify and checks its hostname/action before charging the
quota, looking up a cached result or calling TypeSafe. Successful interpretations
use Cloudflare's native Cache API for five minutes; each API response still contains
fresh usage for the current session and is private/no-store. Invalid, expired, replayed or unavailable verification
fails closed without consuming a description. No widget runs for manual playback.

On your own host, restrict `Content-Security-Policy: frame-ancestors` to the exact
page origins you intend to permit. Do not allow a whole wildcard domain as
though every site on it is trusted. A frame restriction controls where the UI can be
embedded; it does not prevent direct calls to the API. Avoid a conflicting
`X-Frame-Options: SAMEORIGIN` header. If the host page has a restrictive CSP,
its `script-src` and `frame-src` must allow the player's origin. This is separate
from the app's cookie/session checks.

Relevant references:
[Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
[partitioned cookies](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies/Partitioned_cookies),
[frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors),
[server-side Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## Deploy to your Cloudflare account

From the repository root, after authenticating Wrangler to the intended account:

```sh
npm run build
cp cloudflare/wrangler.example.jsonc cloudflare/wrangler.jsonc
npx wrangler d1 create textured
# Put the returned database_id in cloudflare/wrangler.jsonc.
# Set account_id there if your login has multiple accounts.
npx wrangler d1 migrations apply DB --remote --config cloudflare/wrangler.jsonc
npx wrangler secret put TYPESAFE_API_KEY --config cloudflare/wrangler.jsonc
npx wrangler secret put TURNSTILE_SECRET_KEY --config cloudflare/wrangler.jsonc
# Create a managed Turnstile widget for the player's exact hostname.
# Set TURNSTILE_REQUIRED=true and its public TURNSTILE_SITE_KEY in vars.
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

Use the actual URL returned by deployment in the embed snippet. A custom player
hostname can be attached later using a Worker custom domain, after checking for
existing routes/DNS on that hostname. The exact host page origin is needed
before configuring its `frame-ancestors` allowlist. Do not
use the local placeholder D1 ID from `vite.config.ts` for a real deployment.

The Cloudflare credential must permit Workers deployment and D1 administration;
Turnstile setup additionally needs Turnstile permissions. The example deliberately
contains neither account credentials nor an API key. The per-token limit and Turnstile reduce abuse; they do not provide a global spending cap.
