import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compile = (file, replacements = {}) => {
  let code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
};
const semanticUrl = compile('../lib/semantic.ts');
const { DEFAULT_PATCH } = await import(semanticUrl);
const { shareUrl, readShareUrl, shareBase } = await import(compile('../lib/share.ts', { './semantic': semanticUrl }));

const link = shareUrl('https://synth.test/?private=do-not-share#old', 'dolphins swimming');
assert.equal(link, 'https://synth.test/?sound=dolphins+swimming');
assert.deepEqual(readShareUrl(link), { description: 'dolphins swimming' });
assert.deepEqual(readShareUrl('https://synth.test/?sound=dolphins+swimming#patch=%7Bbroken'), { description: 'dolphins swimming' });
assert.equal(readShareUrl(shareUrl('https://synth.test/', 'dolphins & whales 🐬 + waves')).description, 'dolphins & whales 🐬 + waves');
assert.equal(readShareUrl('https://synth.test/?sound=' + 'a'.repeat(401)).description, undefined);
// Existing previously-issued patch links still open, but new links never emit settings.
const legacy = new URL('https://synth.test/');
legacy.hash = new URLSearchParams({ patch: JSON.stringify({ v: 3, description: 'old sound', patch: DEFAULT_PATCH }) });
assert.deepEqual(readShareUrl(legacy.href), { description: 'old sound', patchTitle: 'old sound', patch: DEFAULT_PATCH });
for (const host of ['https://music.example.com/toys/synth', 'https://my-custom-domain.test/listen']) {
  const frame = new URL('https://player.test/?embed=1');
  frame.searchParams.set('parentOrigin', new URL(host).origin);
  frame.searchParams.set('shareBase', host + '?secret=do-not-forward#private');
  const shared = shareUrl(shareBase(frame.href, true), 'dolphins & whales 🐬');
  assert.equal(new URL(shared).origin + new URL(shared).pathname, host);
  assert.equal(new URL(shared).searchParams.has('secret'), false);
  assert.equal(new URL(shared).hash, '', 'new shares contain no knob settings');
  assert.deepEqual([...new URL(shared).searchParams.keys()], ['sound']);
  assert.deepEqual(readShareUrl(shared), { description: 'dolphins & whales 🐬' });
  assert.equal(shareBase(frame.href, false), frame.href, 'standalone ignores host override');
  frame.searchParams.set('shareBase', 'https://unrelated.test/');
  assert.equal(shareBase(frame.href, true), frame.href, 'wrong-origin metadata is ignored');
}
assert.equal(new URL(shareUrl('https://synth.test//other.test/path', 'hello')).origin, 'https://synth.test');
console.log('PASS description-only shares, Unicode, host/custom-domain origins and paths, legacy reads, and exclusion of settings/private URL data.');
