import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const root = new URL('../', import.meta.url);
const plaits = await WebAssembly.compile(fs.readFileSync(new URL('public/audio/plaits.wasm', root)));
const marbles = await WebAssembly.compile(fs.readFileSync(new URL('public/audio/marbles.wasm', root)));
assert.equal(WebAssembly.Module.imports(plaits).length, 0, 'Plaits is self-contained');
assert.equal(WebAssembly.Module.imports(marbles).length, 0, 'Marbles is self-contained');
const keys = ['analog','fm','bell','string','chord','vocal','grain','noise'];
const base = { energy:0.5, brightness:0.65, tension:0.35, space:0.5, movement:0.4, texture:0.4, drift:0.5, harmony:'minor', scale:'minor', gesture:'pluck', engines: Object.fromEntries(keys.map(k => [k, k === 'fm' ? 1 : 0])) };
function make(patch, rate = 48000) {
  let Processor;
  const sandbox = vm.createContext({ WebAssembly, Float32Array, Math, Number, Object, sampleRate:rate,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {}, onmessage:null }; } },
    registerProcessor: (_name, P) => { Processor = P; },
  });
  vm.runInContext(fs.readFileSync(new URL('public/audio/semantic-processor.js',root),'utf8'), sandbox);
  const instance = new Processor({processorOptions:{plaits,marbles,patch:structuredClone(patch)}});
  instance.port.onmessage({ data:{type:'play',playing:true} });
  return instance;
}
function render(patch, seconds = 4, rate = 48000) {
  const instance = make(patch,rate);
  const frames = Math.ceil(seconds * rate / 128);
  const output = [[new Float32Array(128),new Float32Array(128)]];
  const samples = new Float32Array(frames * 128);
  const pitches = new Set();
  let square = 0, peak = 0;
  for (let b = 0; b < frames; b++) {
    assert.equal(instance.process([], output), true);
    pitches.add(instance.notes.join(','));
    samples.set(output[0][0], b*128);
    for (const channel of output[0]) for (const value of channel) {
      assert.ok(Number.isFinite(value),'finite audio');
      square += value * value;
      peak = Math.max(peak,Math.abs(value));
    }
  }
  assert.ok(peak <= 0.49,`bounded output: ${peak}`);
  return { samples, rms:Math.sqrt(square/(frames*256)), peak, pitches:pitches.size, instance };
}
const start = performance.now();
for (const family of keys) {
  for (const gesture of ['pluck','drone']) {
    const p = {...base, gesture, engines:Object.fromEntries(keys.map(k=>[k,k===family?1:0]))};
    const r = render(p,4);
    assert.ok(r.rms > 0.002,`${family}/${gesture} is audible (${r.rms})`);
    console.log(`PASS ${family}/${gesture}: RMS ${r.rms.toFixed(4)}, peak ${r.peak.toFixed(3)}`);
  }
}
function difference(a,b) {
  let square = 0, reference = 0;
  for (let i=0;i<a.length;i++) { square += (a[i]-b[i])**2; reference += a[i]**2; }
  return Math.sqrt(square/Math.max(1e-9,reference));
}
const clean = render({...base,gesture:'drone',texture:0,drift:0},8);
const rough = render({...base,gesture:'drone',texture:1,drift:0},8);
assert.ok(difference(clean.samples,rough.samples)>0.3,'texture changes the rendered sound substantially');
const still = render({...base,gesture:'drone',drift:0},40);
const evolving = render({...base,gesture:'drone',drift:1},40);
assert.ok(difference(still.samples,evolving.samples)>0.3,'slow shifts change a sustained sound');
const locked = render({...base,movement:0,drift:0},20);
const restless = render({...base,movement:1,drift:0},20);
assert.ok(restless.pitches>locked.pitches,`movement expands melodic variation (${locked.pitches} → ${restless.pitches})`);
const otherRate = render(base,3,44100);
assert.ok(otherRate.rms>0.002,'44.1 kHz resampling produces sound');
const muted = [[new Float32Array(128),new Float32Array(128)]];
otherRate.instance.port.onmessage({data:{type:'play',playing:false}});
otherRate.instance.process([],muted);
assert.ok(muted[0].every(channel=>channel.every(v=>v===0)),'stopped processor emits silence');
otherRate.instance.port.onmessage({data:{type:'patch',patch:{...base,texture:1}}});
otherRate.instance.port.onmessage({data:{type:'play',playing:true}});
otherRate.instance.process([],muted);
assert.ok(muted[0][0].some(v=>v!==0),'processor resumes after stop and patch change');
console.log(`PASS texture contrast, slow drift, pattern variation (${locked.pitches} → ${restless.pitches}), resampling, stop/resume`);
// Independent pitch fixtures: equal temperament and the shipped Marbles preset
// voltage offsets, including the microtonal notes that must not round to semitones.
const allowedScales = {
  major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10], pentatonic:[0,2,5,7,9],
  pelog:[0,.1275,.2625,.46,.5883,.7067,.8817].map(v=>v*12),
  bhairav:[0,.0752,.3219,.415,.585,.6601,.9069].map(v=>v*12),
  shri:[0,.1699,.263,.415,.585,.7549,.8479].map(v=>v*12),
  chromatic:Array.from({length:12},(_,i)=>i),
};
const chordIntervals = {0:[0,12],1:[0,7],2:[0,5,7],3:[0,3,7],5:[0,3,10,14],10:[0,4,7]};
const inScale = (note, degrees) => degrees.some(d=>Math.abs(((note%12)+12)%12-d)<1e-6);
const switching = make({...base,gesture:'drone',movement:1});
for (const [scale,degrees] of Object.entries(allowedScales)) {
  for (const gesture of ['drone','pulse','pluck']) {
    const p = {...base,scale,gesture,movement:1,energy:1};
    const instance = make(p);
    const output = [[new Float32Array(128),new Float32Array(128)]];
    for (let b=0;b<1125;b++) {
      // Check the initial held notes as well as every subsequent generated target.
      for (let v=0;v<2;v++) {
        assert.ok(inScale(instance.notes[v],degrees),`${scale}/${gesture}: note ${instance.notes[v]} stays in scale`);
        for (const interval of chordIntervals[instance.chords[v]]) {
          assert.ok(inScale(instance.notes[v]+interval,degrees),`${scale}: chord stays in scale`);
        }
      }
      instance.process([],output);
    }
    switching.port.onmessage({data:{type:'patch',patch:p}});
    assert.ok(switching.notes.every(n=>inScale(n,degrees)),'held notes retune on scale change before another gate');
  }
}
const tuned = make({...base,scale:'pelog'});
assert.ok(Math.abs(tuned.quantize(49.53)-49.53)<1e-6,'Pelog preserves its microtonal second');
console.log('PASS all seven scales across three gestures, compatible chord tones, live scale changes and microtonal tuning.');
const only = family => Object.fromEntries(keys.map(k=>[k,k===family?1:0]));
const morph = make({...base,gesture:'drone',brightness:0.1,texture:0.2,engines:only('analog')});
const blocks = (instance,count) => {
  for (let b=0;b<count;b++) {
    instance.renderBlock();
    assert.ok(instance.blockL.every(v=>Number.isFinite(v)&&Math.abs(v)<=0.49),'transition audio remains finite and bounded');
  }
};
blocks(morph,100);
const nextPatch = {...base,gesture:'drone',brightness:0.9,texture:1,engines:only('fm')};
morph.setPatch(nextPatch);
assert.equal(morph.patch.brightness,0.1,'retargeting does not jump the current value');
const originalBank = morph.activeBank;
blocks(morph,750); // 375ms, halfway through the fade.
assert.ok(Math.abs(morph.patch.brightness-0.5)<1e-9,'parameters reach their midpoint halfway through the fade');
assert.equal(morph.activeBank,originalBank,'outgoing voice stays available through the fade');
assert.ok(morph.banks.every(bank=>bank.voices[0].out.some(v=>v!==0)),'both voice pairs render during the crossfade');
const audible = morph.patch.brightness;
morph.setPatch({...nextPatch,brightness:0.3,engines:only('vocal')});
assert.equal(morph.patch.brightness,audible,'rapid edits start from the currently audible value');
blocks(morph,752);
assert.notEqual(morph.activeBank,originalBank,'first fade finishes without cutting it short');
assert.ok(morph.engineProgress<0.01,'latest family starts fading after the current transition');
blocks(morph,1502);
assert.equal(morph.engineProgress,1);
assert.equal(morph.banks[morph.activeBank].palette.models[0],15,'latest requested family wins');
assert.ok(Math.abs(morph.patch.brightness-0.3)<1e-9,'retargeted controls settle');
const idle=morph.banks[1-morph.activeBank].voices[0];
const lastIdleOutput=Float32Array.from(idle.out);
blocks(morph,20);
assert.deepEqual(idle.out,lastIdleOutput,'inactive pair stops rendering after the fade');
console.log('PASS 750ms parameter easing, audible engine crossfades, rapid retargeting and idle voice suspension.');
console.log(`Rendered more than 267 seconds of DSP in ${((performance.now()-start)/1000).toFixed(2)} seconds.`);
