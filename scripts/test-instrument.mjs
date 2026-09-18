import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mock } from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { act, createElement, useEffect } from 'react';
import { renderToString } from 'react-dom/server';

// Run the real React hooks through SSR/hydration and user actions. Only the
// network and audio device are replaced; DSP is rendered by test-dsp.mjs.
const require = createRequire(import.meta.url);
const moduleUrl = name => pathToFileURL(require.resolve(name)).href;
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
function compile(file, imports = {}) {
  let source = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const [from, to] of Object.entries({
    react: moduleUrl('react'), 'react/jsx-runtime': moduleUrl('react/jsx-runtime'), ...imports,
  })) source = source.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return dataUrl(source);
}
const semanticUrl = compile('lib/semantic.ts');
const { DEFAULT_PATCH, EXAMPLES } = await import(semanticUrl);
const shareUrl = compile('lib/share.ts', { './semantic': semanticUrl });
const { usePlayerLocation } = await import(compile('hooks/use-player-location.ts', {
  '@/lib/share': shareUrl, '@/lib/semantic': semanticUrl,
}));
const { useInstrument } = await import(compile('hooks/use-instrument.ts', {
  '@/lib/semantic': semanticUrl,
  '@/lib/synth': dataUrl(`export class SynthEngine {
    playing = false; closed = false;
    update(patch) { this.patch = patch; }
    async unlock() {}
    setVolume(value) { this.volume = value; }
    start() { this.playing = true; }
    stop() { this.playing = false; }
    close() { this.closed = true; }
  }`),
}));
const { useEmbedBridge } = await import(compile('hooks/use-embed-bridge.ts'));
const { DescriptionHeader } = await import(compile('components/description-header.tsx', {
  '@/lib/share': shareUrl, 'lucide-react': moduleUrl('lucide-react'),
}));
const dom = new JSDOM('<div id="root"></div><div id="share"></div>', {
  url: 'https://player.example/?sound=whales+singing', pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'location', 'navigator']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const { createRoot, hydrateRoot } = await import('react-dom/client');
const now = Date.now();
mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
const usage = { limit: 50, remaining: 50, resetsAt: new Date(now + 86400000).toISOString(), scope: 'browser' };
const requests = [];
let statusCalls = 0;
globalThis.fetch = async (url, options = {}) => {
  assert.equal(url, '/api/interpret');
  if (options.method !== 'POST') {
    statusCalls++;
    return Response.json({ configured: true, usage, turnstileSiteKey: null });
  }
  return new Promise(resolve => requests.push({
    description: JSON.parse(options.body).description,
    signal: options.signal,
    respond: (patch = DEFAULT_PATCH) => resolve(Response.json({ patch, model: 'fixture', elapsedMs: 10, answers: {}, usage })),
  }));
};
let current;
function Probe() {
  const initial = usePlayerLocation();
  const instrument = useInstrument(initial);
  useEmbedBridge(initial.embedded, initial.url, instrument.pause);
  useEffect(() => { current = instrument; });
  return createElement('main', { className: 'instrument' }, instrument.description);
}
const container = document.getElementById('root');
container.innerHTML = renderToString(createElement(Probe));
assert.equal(container.textContent, EXAMPLES[0], 'SSR has a deterministic initial patch');
const hydrationErrors = [];
let root;
let shareRoot;
try {
  await act(async () => { root = hydrateRoot(container, createElement(Probe), { onRecoverableError: error => hydrationErrors.push(error) }); });
  assert.deepEqual(hydrationErrors, []);
  assert.equal(current.description, 'whales singing', 'the shared description hydrates from the browser URL');
  assert.equal(current.source, 'example');
  assert.equal(statusCalls, 1, 'hydration does not duplicate session creation');
  assert.equal(requests.length, 0, 'prefilling a description makes no paid request');

  await act(async () => { await current.togglePlay(); });
  assert.equal(current.playing, true);
  await act(async () => { mock.timers.tick(851); });
  assert.equal(requests.length, 1, 'Play interprets the prefilled description after the usual debounce');
  assert.equal(requests[0].description, 'whales singing');
  await act(async () => { requests[0].respond({ ...DEFAULT_PATCH, texture: 0.8 }); });
  assert.equal(current.source, 'live');
  assert.equal(current.patch.texture, 0.8);

  let pending;
  await act(async () => { pending = current.interpret('a brass moon'); });
  const outdated = requests.at(-1);
  await act(async () => { current.manual('brightness', 91); });
  assert.equal(outdated.signal.aborted, true);
  await act(async () => { outdated.respond(); await pending; });
  assert.equal(current.patch.brightness, 0.91, 'a late response cannot overwrite a manual edit');
  assert.equal(current.result.patch.texture, 0.8, 'the original model result survives manual edits');

  await act(async () => { pending = current.interpret('old description'); });
  const oldDescription = requests.at(-1);
  await act(async () => { current.editDescription('new description'); });
  await act(async () => { oldDescription.respond(); await pending; });
  assert.equal(current.description, 'new description');
  assert.equal(current.source, 'manual', 'editing cancels an in-flight interpretation');
  await act(async () => { current.pause(); });
  const countAfterPause = requests.length;
  await act(async () => { mock.timers.tick(1000); });
  assert.equal(requests.length, countAfterPause, 'Stop cancels the debounced request');
  assert.equal(current.engine.playing, false);
  const engine = current.engine;
  await act(async () => { root.unmount(); });
  root = null;
  assert.equal(engine.closed, true, 'unmount releases the audio device');

  const legacyPatch = { ...DEFAULT_PATCH, energy: 0.71 };
  const legacyUrl = new URL('https://player.example/');
  legacyUrl.hash = new URLSearchParams({ patch: JSON.stringify({ v: 3, description: 'saved world', patch: legacyPatch }) });
  dom.reconfigure({ url: legacyUrl.href });
  await act(async () => { root = createRoot(container); root.render(createElement(Probe)); });
  assert.equal(current.description, 'saved world');
  assert.equal(current.source, 'shared');
  assert.equal(current.patch.energy, 0.71);
  const beforeLegacyPlay = requests.length;
  await act(async () => { await current.togglePlay(); mock.timers.tick(1000); });
  assert.equal(requests.length, beforeLegacyPlay, 'legacy saved settings play without inference');
  await act(async () => { root.unmount(); });
  root = null;

  dom.reconfigure({ url: 'https://player.example/?embed=1&parentOrigin=https%3A%2F%2Fhost.example&shareBase=https%3A%2F%2Fhost.example%2Fmusic' });
  const messages = [];
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  Object.defineProperty(window, 'parent', { configurable: true, value: parent });
  await act(async () => { root = createRoot(container); root.render(createElement(Probe)); });
  assert.equal(messages[0].data.type, 'textured:ready');
  assert.equal(messages[0].origin, 'https://host.example');
  await act(async () => { await current.togglePlay(); });
  const pauseMessage = (source, origin) => window.dispatchEvent(new window.MessageEvent('message', {
    source, origin, data: { type: 'textured:pause' },
  }));
  await act(async () => { pauseMessage(parent, 'https://other.example'); pauseMessage({}, 'https://host.example'); });
  assert.equal(current.playing, true, 'untrusted messages cannot stop playback');
  await act(async () => { pauseMessage(parent, 'https://host.example'); });
  assert.equal(current.playing, false, 'closing the trusted host pauses playback');

  let copiedUrl;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async url => { copiedUrl = url; },
  } });
  const shareContainer = document.getElementById('share');
  await act(async () => { shareRoot = createRoot(shareContainer); shareRoot.render(createElement(DescriptionHeader, { key: 'one', description: 'whales singing' })); });
  await act(async () => { shareContainer.querySelector('button').click(); });
  assert.equal(copiedUrl, 'https://host.example/music?sound=whales+singing');
  assert.match(shareContainer.textContent, /Link copied/);
  navigator.clipboard.writeText = async () => { throw new Error('clipboard denied'); };
  await act(async () => { shareContainer.querySelector('button').click(); });
  assert.equal(shareContainer.querySelector('input').value, copiedUrl);
  assert.equal(shareContainer.querySelector('a'), null, 'fallback cannot navigate inside the frame');
  await act(async () => { shareRoot.render(createElement(DescriptionHeader, { key: 'two', description: 'dolphins swimming' })); });
  assert.equal(shareContainer.querySelector('input'), null, 'editing clears the stale share fallback');
  console.log('PASS React hydration, URL prefill, playback, cancelled requests, manual edits, legacy patches, trusted embed pause and clipboard fallback.');
} finally {
  await act(async () => { root?.unmount(); shareRoot?.unmount(); });
  mock.timers.reset();
  dom.window.close();
}
