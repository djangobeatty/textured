# Textured

*Sounds of words.*

A musical toy from **[Fluxus](https://fluxus.io/), an AI product studio**. An instrument you play with words. TypeSafe interprets a short description; the original Plaits and Marbles DSP, compiled to WebAssembly, turns the resulting typed judgments into sound inside a Web Audio worklet.

## Run locally

Requires Node 22.13+ (Node 24 recommended). A TypeSafe API key enables interpretation; playback and manual controls work without one.

```sh
npm ci
cp .env.example .env.local
# Optional: set TYPESAFE_API_KEY in .env.local to interpret descriptions
npm run build
# First run only: initialize local storage
npm run db:setup
npm start
```

Open the local URL printed by the server. Click **Make sound** to interpret your words, or **Play** to hear the initial patch. Edit the description while playing to reshape the sound after a short pause in typing. Play/Stop, voices and blend, playing style, volume, and all knobs and sliders work independently of inference. The initial patch is explicitly hand-tuned; it works without a key. The first play loads the audio engines.

Try **An underwater cathedral, slowly waking**. Keep Movement low and turn up **Slow shifts** for a slowly evolving drone. Change Texture from 0 to 100 to move through the engine's timbre and morph parameters and add saturation. Increase Movement for wider, less repetitive melodies, irregular gates and faster timbral modulation.

**Scale** sets the notes the instrument can use: Marbles' Major, Minor, Pentatonic, Pelog, Bhairav and Shri presets, plus Chromatic for all twelve semitones. TypeSafe selects a scale from your description; the selector overrides it immediately. The tonic is C. Pelog, Bhairav and Shri preserve the firmware's microtonal tuning. These are the module's preset interpretations, not a complete implementation of a musical tradition.

Movement varies the phrase and range within the scale. Marbles' pitch voltages retain their original 1V/octave relationship, and a final quantizer prevents out-of-scale target notes. Floating chords choose compatible chord shapes; microtonal scales fall back to octave layers where no fixed Plaits chord fits. Portamento and subtle drift still move the sounding pitch around these targets.

Drone notes use a light portamento (roughly 75ms to travel 95% of an interval). Slow shifts adds subtle pitch drift (up to ±18 cents, scaled by Tension) alongside the evolving timbre and space.

Patch values ease from the current sound to their new settings over 750ms. Sound-family and playing-style changes crossfade between two preallocated voice pairs; only the active pair renders once the fade finishes. Rapid family changes finish the current fade and then move to the latest requested family. Effect parameters settle over roughly the same time. Scale selection retunes note targets immediately, preserving the short note glide.

## How it works

One request asks eleven independent questions over the same description:

- Seven Score questions measure energy, brightness, tension, acoustic space, movement, texture, and slow evolution. Each has five descriptive levels; its 0–4 score maps to a 0–1 control.
- A Choice question returns probabilities over eight sound families. The two highest probabilities are normalized and used to blend two independently rendered Plaits voices. The UI shows all eight original probabilities in a labelled bar chart. Voice A/B selectors and a blend fader edit the actual two-voice mix, with solo positions at each end; a new interpretation resets the voices and balance. The six Character knobs plus Slow shifts are the seven continuous model controls. This is an artistic mixture, not an uncertainty claim about the sound.
- A Choice question selects major, minor, suspended, or chromatic harmony.
- A Choice question selects the melodic scale. The harmonic preference above is used only when its chord tones fit the scale.
- A Choice question selects sustained/drone, rhythmic/pulse, or scattered/pluck articulation.

`lib/semantic.ts` contains the questions, typed patch and validation. `public/audio/semantic-processor.js` runs two Plaits voices and a Marbles generator on the audio thread at the firmware's 48 kHz, resampling when necessary. Marbles generates the gates and pitch voltages; there is no fixed melody. Slow shifts overlap 23–71 second cycles for timbre, harmonics, stereo balance, filtering and reverb. The native Web Audio effects and transport live in `lib/synth.ts`. `app/api/interpret/route.ts` keeps the API key on the server.

The page also registers two [WebMCP](https://github.com/webmachinelearning/webmcp) tools, `read_synth_patch` and `interpret_sound_description`, in `hooks/use-instrument-tools.ts`. WebMCP is a draft browser API that lets a page offer functions to an AI assistant built into the visitor's browser. An assistant could read the current controls or send a description through the same interpretation path a visitor uses, with that visitor's cookie and allowance. Nothing is exposed over the network and there is no MCP server. No shipping browser supports the API yet, so the registration is inert until one does.

The model does not generate audio or hear the output. The musical mapping is authored in code. Model judgments are subjective and can be wrong; the knobs always remain yours. API latency is measured on the server, including retries. Cloudflare's native Cache API retains a successful interpretation for five minutes. Repeated descriptions within that window can reuse it and are labelled cached; the reported latency belongs to the original inference. The key includes the model, questions and description. Outward API responses remain private/no-store so their per-browser allowance is never shared. Sound playback never waits for network calls after starting.

## Embedding

A single script tag mounts the full player and controls directly in another page.
See [the embedding guide](docs/embedding.md) for the snippet, optional prefilled
sound, Cloudflare hosting requirements and session/security behaviour.

## Sharing

**Share this sound** copies only the description, for example `?sound=dolphins+swimming`.
In an embed, the link uses the containing page's current domain and path, so moving
the host page to a custom domain needs no embed-code change. Opening
the link prefills the words; the visitor asks TypeSafe to interpret them again.
Knob positions, audio and the playhead are not included. Previously issued patch
links still open, but new links contain no patch/settings fragment.

Drag any of the six rotary knobs up/right to increase or down/left to decrease. Hold Shift for fine adjustment, use arrow keys for steps and Page Up/Down for larger changes, or double-click to restore that knob's initial setting. Knobs, Slow shifts and Volume work without inference.

## Development

```sh
npm run check
```

This runs lint (including zero warnings), TypeScript, every test suite and the
production build. It needs no API keys and makes no paid calls. GitHub Actions
runs the same command for pushes to `main` and pull requests.

After the first build and `npm run db:setup`, use `npm run dev` for hot reload.
`npm start` serves the last production build locally; rebuild to see source changes.
Neither command deploys anything. For your own Worker, follow the
[Cloudflare deployment guide](docs/embedding.md#deploy-to-your-cloudflare-account).

The code is split by responsibility:

| Location | Responsibility |
| --- | --- |
| `app/page.tsx` | Instrument layout and controls |
| `components/` | Knobs, voice blend, waveform, clipboard sharing and browser verification |
| `hooks/use-instrument.ts` | Playback, interpretation requests, cancellation and quota display |
| Other `hooks/` | Initial URL state, trusted embed messages and WebMCP tool registration |
| `lib/semantic.ts` | TypeSafe questions, typed patches and response validation |
| `lib/synth.ts`, `public/audio/` | Web Audio effects, audio worklet and precompiled DSP |
| `app/api/interpret/`, `lib/quota.ts`, `lib/turnstile.ts` | Server-only inference and API protection |
| `lib/interpretation-cache.ts` | Cloudflare's five-minute result cache |
| `dsp/`, `scripts/build-dsp.py` | DSP wrappers and pinned-source rebuild recipe |

Targeted checks are available as `npm run test:instrument`, `test:semantic`,
`test:share`, `test:embed`, `test:quota` and `test:dsp`. The React tests cover
hydration of shared descriptions, playback, stale-response cancellation, manual
edits, legacy patch links, trusted parent messages and clipboard fallback.

Uses React, TypeScript, Vinext, and the native Web Audio API. Production server output targets Cloudflare Workers. Set `TYPESAFE_API_KEY` as a runtime secret on your host. Never prefix it with a public/browser environment prefix. Cloudflare serves and caches static assets; successful inference results use its native Cache API with a five-minute TTL, without an in-memory fallback cache. Daily allowances are persisted in D1.

## Daily allowance

The server permits **50 submitted descriptions per UTC day** by default, configured with `TYPESAFE_DAILY_LIMIT` (0 pauses interpretation). Every verified submission reserves one slot before checking Cloudflare's result cache or calling TypeSafe. Repeated descriptions (including cache hits) and failed upstream attempts count; the existing single upstream retry belongs to the same description slot. This is a description allowance, not a precise cap on provider billing. Playback and manual controls do not use it; interpreting a shared description does.

Visitors receive a random 256-bit token in a Secure, HttpOnly, SameSite cookie. Only its hash is stored, and tokens expire after 30 days. Reloading reuses the token; there is no periodic token refresh that resets the counter. New browser sessions can obtain new allowances, including after clearing cookies. An email, user ID or token supplied in the request never selects the allowance. This does **not** identify a person or impose an overall paid-call cap. The standalone Cloudflare deployment requires a fresh, server-verified Turnstile token for each description; session-issuance throttling and an overall spending ceiling remain separate controls.

The D1 conditional insert/update reserves each slot atomically, including concurrent requests across Workers. Each UTC date has its own counter. Exhausted requests return HTTP 429 with the remaining allowance, reset time and Retry-After; unavailable quota storage fails closed before any TypeSafe call. The UI shows the allowance and leaves the synth controls usable at the limit.

`npm run test:quota` exercises real local D1 storage, concurrent requests, midnight rollover, separate browsers, browser tokens, and the API route with stubbed TypeSafe and Turnstile services, including invalid/replayed tokens and hostname/action checks. It makes no paid API calls. Schema changes belong in `db/schema.ts`; run `npm run db:generate` and apply new local migrations in order. Apply them to production with `npx wrangler d1 migrations apply DB --remote --config cloudflare/wrangler.jsonc`. For hot-reloading development, use `npm run dev` after initializing local D1.

The DSP test renders the real shipped worklet and WebAssembly in a Node harness. It checks every sound family, finite/bounded output, audible differences from Texture and Slow shifts, increased melodic variation from Movement, 44.1 kHz resampling, stop/resume, scale membership across all three gestures, compatible chord tones, live scale changes and microtonal tuning. It does not replace an actual listening test on target devices.

The precompiled binaries are checked in, so normal app development needs no C++ toolchain. To rebuild them, install Emscripten 4.0.20, activate its environment, then run `python3 scripts/build-dsp.py`. The script fetches pinned upstream revisions. `DSP_EURORACK` and `DSP_STMLIB` can point to local checkouts at those exact commits. The C wrappers in `dsp/` are adapted from [NoodleRack's build chain](https://github.com/stets/noodlerack-dsp-build).

Contributions: improve the sound mappings, add clearer rubric examples, or extend the engine. Keep numeric mappings explicit and keep network calls outside audio processing.

## License

MIT. Plaits, Marbles and stmlib DSP are by Émilie Gillet; the source wrappers are by stets. Full attribution and MIT terms ship in `public/audio/NOTICE.txt` and `public/audio/LICENSE.txt`. Mutable Instruments is not affiliated with this project. Dependencies retain their respective licenses.
