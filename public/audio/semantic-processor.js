// Real Plaits + Marbles DSP at 48 kHz. No network, timers, or allocations in process().
// The worklet owns musical time; main-thread stalls cannot interrupt sequencing.
const DSP_RATE = 48000;
const BLOCK = 24;
const PATCH_FADE_SECONDS = 0.75;
const PATCH_STEP = BLOCK / (DSP_RATE * PATCH_FADE_SECONDS);
// A light exponential glide: drone notes travel 95% of the interval in ~75ms.
const DRONE_GLIDE = 1 - Math.exp(-BLOCK / (DSP_RATE * 0.025));
const TAU = Math.PI * 2;
const SMOOTH_KEYS = ["energy", "brightness", "tension", "space", "movement", "texture", "drift"];
// Indices in upstream plaits/dsp/chords/chord_bank.cc (11-chord default bank).
const CHORD_INDEX = { major: 10, minor: 3, suspended: 2, chromatic: 5 };
const CHORD_NOTES = { 10: [0, 4, 7], 3: [0, 3, 7], 2: [0, 5, 7], 5: [0, 3, 10, 14], 1: [0, 7], 0: [0] };
const CHORD_FALLBACKS = [10, 3, 2, 1];
const ENGINES = { analog: 8, fm: 10, bell: 20, string: 19, chord: 14, vocal: 15, grain: 11, noise: 17 };
// Marbles preset indices and prominent scale degrees from dsp/marbles.cc.
// Microtonal presets retain their original volts/octave offsets in semitones.
const SCALES = {
  major: { index: 0, notes: [0, 2, 4, 5, 7, 9, 11] },
  minor: { index: 1, notes: [0, 2, 3, 5, 7, 8, 10] },
  pentatonic: { index: 2, notes: [0, 2, 5, 7, 9] },
  pelog: { index: 3, notes: [0, 1.53, 3.15, 5.52, 7.0596, 8.4804, 10.5804] },
  bhairav: { index: 4, notes: [0, 0.9024, 3.8628, 4.98, 7.02, 7.9212, 10.8828] },
  shri: { index: 5, notes: [0, 2.0388, 3.156, 4.98, 7.02, 9.0588, 10.1748] },
  chromatic: { index: 0, notes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = t => t * t * (3 - 2 * t);
const samePalette = (a, b) => a && b && a.gesture === b.gesture &&
  a.models[0] === b.models[0] && a.models[1] === b.models[1] &&
  Math.abs(a.weights[0] - b.weights[0]) < 1e-6;

class SemanticInstrument extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { plaits, marbles, patch } = options.processorOptions;
    // Two preallocated pairs: render the second pair only during a crossfade.
    this.banks = [0, 1].map(() => ({ palette: null, voices: [0, 1].map(() => {
        const e = new WebAssembly.Instance(plaits, {}).exports;
        e._initialize?.();
        e.p_init();
        return { e, out: new Float32Array(e.memory.buffer, e.p_out(), BLOCK), aux: new Float32Array(e.memory.buffer, e.p_aux(), BLOCK) };
      }) }));
    this.activeBank = 0;
    this.engineProgress = 1;
    this.pendingPalette = null;
    this.m = new WebAssembly.Instance(marbles, {}).exports;
    this.m._initialize?.();
    this.m.m_init();
    this.gates = [this.m.m_t1(), this.m.m_t3()].map(p => new Float32Array(this.m.memory.buffer, p, BLOCK));
    this.pitches = [this.m.m_x1(), this.m.m_x3()].map(p => new Float32Array(this.m.memory.buffer, p, BLOCK));
    this.y = new Float32Array(this.m.memory.buffer, this.m.m_y(), BLOCK);
    this.patch = { ...patch };
    this.target = patch;
    this.parameterFrom = { ...patch };
    this.parameterProgress = 1;
    this.previousGates = [false, false];
    this.notes = [48, 55];
    this.smoothNotes = [48, 55];
    this.chords = [0, 0];
    this.blockL = new Float32Array(BLOCK);
    this.blockR = new Float32Array(BLOCK);
    this.index = BLOCK;
    this.time = 0;
    this.active = false;
    this.primed = false;
    this.phase = 0;
    this.smoothY = 0;
    this.dcL = 0;
    this.dcR = 0;
    this.setPatch(patch);
    this.port.onmessage = ({ data }) => {
      if (data.type === "patch") this.setPatch(data.patch);
      if (data.type === "play") this.active = data.playing;
    };
    this.port.postMessage({ type: "ready" });
  }
  setPatch(patch) {
    this.parameterFrom = { ...this.patch };
    this.parameterProgress = 0;
    this.target = patch;
    const ranked = Object.entries(patch.engines).sort((a, b) => b[1] - a[1]);
    const sum = ranked[0][1] + ranked[1][1];
    const palette = {
      models: [ENGINES[ranked[0][0]], ENGINES[ranked[1][0]]],
      weights: [ranked[0][1] / sum, ranked[1][1] / sum],
      gesture: patch.gesture,
    };
    if (!this.banks[this.activeBank].palette) this.banks[this.activeBank].palette = palette;
    else if (this.engineProgress < 1) {
      // Finish the current fade without a jump, then use the most recent request.
      this.pendingPalette = samePalette(palette, this.banks[1 - this.activeBank].palette) ? null : palette;
    } else this.beginPalette(palette);
    this.patch.gesture = patch.gesture;
    this.patch.harmony = patch.harmony;
    this.patch.scale = patch.scale;
    this.scale = SCALES[patch.scale] || SCALES.pentatonic;
    // Retune held notes immediately; the short glide still smooths the change.
    for (let v = 0; v < 2; v++) {
      this.notes[v] = this.quantize(this.notes[v]);
      this.chords[v] = this.chordFor(this.notes[v]);
    }
  }
  beginPalette(palette) {
    if (samePalette(palette, this.banks[this.activeBank].palette)) return;
    this.banks[1 - this.activeBank].palette = palette;
    this.engineProgress = 0;
  }
  quantize(midi) {
    const scale = this.scale.notes;
    let best = 48, distance = Infinity;
    for (let octave = 2; octave < 8; octave++) {
      for (let i = 0; i < scale.length; i++) {
        const candidate = octave * 12 + scale[i];
        const d = Math.abs(candidate - midi);
        if (d < distance) { distance = d; best = candidate; }
      }
    }
    return best;
  }
  chordFits(index, note) {
    for (const interval of CHORD_NOTES[index]) {
      const pitch = ((note + interval) % 12 + 12) % 12;
      let found = false;
      for (const degree of this.scale.notes) {
        if (Math.abs(pitch - degree) < 0.001) { found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }
  chordFor(note) {
    const preferred = CHORD_INDEX[this.patch.harmony];
    if (this.chordFits(preferred, note)) return preferred;
    for (const index of CHORD_FALLBACKS) {
      if (this.chordFits(index, note)) return index;
    }
    // Fixed equal-tempered chords cannot voice every microtonal scale.
    // Octave layers retain the chosen tuning instead of adding foreign notes.
    return 0;
  }
  renderBlock() {
    const p = this.patch;
    // Retarget from the current audible values, easing to the new patch in 750ms.
    this.parameterProgress = Math.min(1, this.parameterProgress + PATCH_STEP);
    const amount = ease(this.parameterProgress);
    for (const key of SMOOTH_KEYS) {
      p[key] = this.parameterFrom[key] + (this.target[key] - this.parameterFrom[key]) * amount;
    }
    const fading = this.engineProgress < 1;
    if (fading) this.engineProgress = Math.min(1, this.engineProgress + PATCH_STEP);
    const blend = fading ? ease(this.engineProgress) : 0;
    const current = this.banks[this.activeBank];
    const next = this.banks[1 - this.activeBank];
    const t = this.time;
    // Overlapping 23–61 second cycles give a slowly evolving contour.
    const a = Math.sin(TAU * t / 37);
    const b = Math.sin(TAU * t / 61 + 1.7);
    const c = Math.sin(TAU * t / 23 + 3.1);
    const movement = p.movement;
    const bpm = 32 + p.energy * 152;
    const oldRate = current.palette.gesture === "drone" ? 0.28 : current.palette.gesture === "pulse" ? 2 : 0.65 + p.energy;
    const newRate = fading ? (next.palette.gesture === "drone" ? 0.28 : next.palette.gesture === "pulse" ? 2 : 0.65 + p.energy) : oldRate;
    const rate = oldRate + (newRate - oldRate) * blend;
    this.m.m_render(bpm * rate, 0.5, movement * movement * 0.75,
      0, 0.5 * (1 - movement), movement < 0.4 ? 8 : 13,
      0.12 + movement * 0.7, 0.45, p.scale === "chromatic" ? 0.5 : 0.85, this.scale.index, 0, 0, BLOCK);
    this.smoothY += (clamp(this.y[0] / 5, -1, 1) - this.smoothY) * 0.0002;
    const slow = p.drift * (a * 0.62 + b * 0.25 + this.smoothY * 0.13);
    const fast = Math.sin(TAU * t * (0.12 + movement * 1.7)) * movement * movement;
    for (let v = 0; v < 2; v++) {
      const gate = this.gates[v][0] > 0.5;
      if (gate && !this.previousGates[v]) {
        // Preserve Marbles' 1V/octave tuning. Movement changes its spread above,
        // never stretches intervals; the final quantizer keeps targets in scale.
        this.notes[v] = this.quantize(48 + this.pitches[v][0] * 12 + v * 12);
        this.chords[v] = this.chordFor(this.notes[v]);
      }
      this.previousGates[v] = gate;
      this.smoothNotes[v] += (this.notes[v] - this.smoothNotes[v]) * (p.gesture === "drone" ? DRONE_GLIDE : 0.15);
      const note = this.smoothNotes[v] + slow * p.tension * 0.18;
      const timbre = clamp(0.06 + p.brightness * 0.43 + p.texture * 0.45 + slow * 0.28 + fast * 0.13);
      const morph = clamp(0.08 + p.texture * 0.78 + p.drift * b * 0.27 + fast * 0.15);
      for (let bankIndex = 0; bankIndex < 2; bankIndex++) {
        if (!fading && bankIndex !== this.activeBank) continue;
        const bank = this.banks[bankIndex];
        const model = bank.palette.models[v];
        const drone = bank.palette.gesture === "drone";
        const struckModel = model === 19 || model === 20;
        const harmonics = model === 14 ? (this.chords[v] + 0.5) / (11 * 1.02)
          : clamp(0.12 + p.tension * 0.65 + p.texture * 0.12 + slow * 0.2);
        const decay = drone ? 0.88 : clamp(0.12 + p.space * 0.63 + p.drift * c * 0.1);
        bank.voices[v].e.p_render(model, note, harmonics, timbre, morph, decay, 0.45 + p.brightness * 0.5,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 1, gate ? 1 : 0, drone && !struckModel ? 0 : 8, BLOCK);
      }
    }
    const pan = 0.28 * p.drift * Math.sin(TAU * t / 47);
    const breath = 0.86 + 0.14 * p.drift * Math.sin(TAU * t / 31);
    const drive = 1 + p.texture * p.texture * 4;
    const normalizer = Math.tanh(drive);
    for (let i = 0; i < BLOCK; i++) {
      let first = 0, second = 0, alternate = 0;
      for (let bankIndex = 0; bankIndex < 2; bankIndex++) {
        if (!fading && bankIndex !== this.activeBank) continue;
        const bank = this.banks[bankIndex];
        const gain = bankIndex === this.activeBank ? 1 - blend : blend;
        const w0 = bank.palette.weights[0] * gain, w1 = bank.palette.weights[1] * gain;
        first += bank.voices[0].out[i] * w0;
        second += bank.voices[1].out[i] * w1;
        alternate += (bank.voices[0].aux[i] * w0 + bank.voices[1].aux[i] * w1) * (0.06 + p.space * 0.14);
      }
      let left = first * (0.85 - pan) + second * (0.7 + pan) + alternate;
      let right = first * (0.7 + pan) + second * (0.85 - pan) - alternate;
      this.dcL += (left - this.dcL) * 0.002;
      this.dcR += (right - this.dcR) * 0.002;
      left = Math.tanh((left - this.dcL) * drive) / normalizer;
      right = Math.tanh((right - this.dcR) * drive) / normalizer;
      this.blockL[i] = Number.isFinite(left) ? left * breath * 0.48 : 0;
      this.blockR[i] = Number.isFinite(right) ? right * breath * 0.48 : 0;
    }
    if (fading && this.engineProgress === 1) {
      this.activeBank = 1 - this.activeBank;
      if (this.pendingPalette) {
        this.beginPalette(this.pendingPalette);
        this.pendingPalette = null;
      }
    }
    this.time += BLOCK / DSP_RATE;
    this.index = 0;
  }
  advance() {
    if (this.index >= BLOCK) this.renderBlock();
    this.nextL = this.blockL[this.index];
    this.nextR = this.blockR[this.index++];
  }
  process(_inputs, outputs) {
    const left = outputs[0][0], right = outputs[0][1];
    if (!this.active || !left || !right) return true;
    if (!this.primed) {
      this.advance(); this.l0 = this.nextL; this.r0 = this.nextR;
      this.advance(); this.l1 = this.nextL; this.r1 = this.nextR;
      this.primed = true;
    }
    // Resample from the firmware's fixed 48 kHz when the browser chooses another rate.
    const ratio = DSP_RATE / sampleRate;
    for (let i = 0; i < left.length; i++) {
      left[i] = this.l0 + (this.l1 - this.l0) * this.phase;
      right[i] = this.r0 + (this.r1 - this.r0) * this.phase;
      this.phase += ratio;
      while (this.phase >= 1) {
        this.phase -= 1;
        this.l0 = this.l1; this.r0 = this.r1;
        this.advance(); this.l1 = this.nextL; this.r1 = this.nextR;
      }
    }
    return true;
  }
}
registerProcessor("semantic-instrument", SemanticInstrument);
