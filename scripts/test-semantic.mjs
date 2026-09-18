import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../lib/semantic.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const { DEFAULT_PATCH, QUESTIONS, dimensionKeys, engineKeys, scaleKeys, parseInterpretation, readSharedPatch, validPatch } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

assert.equal(Object.keys(QUESTIONS).length, 11);
assert.ok(validPatch(DEFAULT_PATCH));
const scores = Object.fromEntries(dimensionKeys.map(k => [k, {type:'score',score:2,confidence:1,probabilities:{0:0,1:0,2:1,3:0,4:0}}]));
const choice = (name, keys) => ({type:'choice',choice:name,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===name?1:0]))});
const response = {model:'fixture',answers:{...scores,engine:choice('bell',engineKeys),harmony:choice('minor',['major','minor','suspended','chromatic']),scale:choice('pelog',scaleKeys),gesture:choice('pluck',['drone','pulse','pluck'])}};
const parsed = parseInterpretation(response,100);
assert.equal(parsed.patch.engines.bell,1);
assert.equal(parsed.patch.drift,0.5);
assert.equal(parsed.patch.gesture,'pluck');
assert.equal(parsed.patch.scale,'pelog');
assert.ok(validPatch(parsed.patch));
assert.deepEqual(readSharedPatch(JSON.parse(JSON.stringify(parsed.patch))),parsed.patch,'new shared patches round-trip');
assert.equal(validPatch({...parsed.patch,texture:NaN}),false);
assert.equal(validPatch({...parsed.patch,engines:{...parsed.patch.engines,bell:0.1}}),false);
assert.equal(readSharedPatch({energy:1}),null);
const legacy = {energy:0.2,brightness:0.4,tension:0.3,space:0.7,movement:0.5,texture:0.3,harmony:'minor',voices:{sine:0.1,triangle:0.5,sawtooth:0.3,square:0.1}};
assert.ok(validPatch(readSharedPatch(legacy)));
assert.equal(readSharedPatch(legacy)?.engines.analog,0.4);
assert.equal(readSharedPatch(legacy)?.scale,'minor');
for (const [harmony, scale] of Object.entries({major:'major',minor:'minor',suspended:'pentatonic',chromatic:'chromatic'})) {
  const v2 = {...DEFAULT_PATCH,harmony};
  delete v2.scale;
  assert.deepEqual(readSharedPatch(v2),{...v2,scale},'version-2 patches receive a compatible scale');
}
for (const scale of scaleKeys) {
  const p = {...DEFAULT_PATCH,scale};
  assert.deepEqual(readSharedPatch(JSON.parse(JSON.stringify(p))),p);
}
assert.equal(validPatch({...DEFAULT_PATCH,scale:'unknown'}),false);
assert.equal(readSharedPatch({...DEFAULT_PATCH,scale:'unknown'}),null);
assert.equal(readSharedPatch({...DEFAULT_PATCH,scale:null}),null);
assert.throws(()=>parseInterpretation({...response,answers:{...response.answers,scale:undefined}},0));
assert.throws(()=>parseInterpretation({...response,answers:{...response.answers,scale:choice('unknown',['unknown'])}},0));
assert.throws(()=>parseInterpretation({...response,answers:{...response.answers,engine:choice('missing',['missing'])}},0));
assert.throws(()=>parseInterpretation({...response,answers:{...response.answers,drift:{...scores.drift,score:5}}},0));
console.log('PASS eleven-question validation, scale selection, control bounds, all-scale share round-trips and v1/v2 migration.');

const semanticUrl = 'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64');
const blendSource = fs.readFileSync(new URL('../lib/voice-blend.ts', import.meta.url), 'utf8').replace("'./semantic'", JSON.stringify(semanticUrl));
const blendCode = ts.transpileModule(blendSource, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const { readVoiceBlend, blendEngines } = await import('data:text/javascript;base64,' + Buffer.from(blendCode).toString('base64'));
const initialBlend = readVoiceBlend(DEFAULT_PATCH.engines);
assert.equal(initialBlend.a, 'chord');
assert.equal(initialBlend.b, 'bell');
assert.ok(Math.abs(initialBlend.mix - 1 / 9) < 1e-12);
for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
  const engines = blendEngines({a:'grain',b:'vocal',mix});
  assert.ok(validPatch({...DEFAULT_PATCH,engines}));
  assert.equal(engines.grain,1-mix);
  assert.equal(engines.vocal,mix);
  assert.ok(engineKeys.filter(k=>k!=='grain'&&k!=='vocal').every(k=>engines[k]===0));
}
assert.equal(blendEngines({a:'fm',b:'bell',mix:-1}).fm,1);
assert.equal(blendEngines({a:'fm',b:'bell',mix:2}).bell,1);
console.log('PASS audible two-voice balance, both solo endpoints and normalized patches.');
