import { DEFAULT_PATCH, type Patch } from "./semantic";
// Web Audio exponential ramps cover 95% of the change in ~750ms.
const PATCH_TIME_CONSTANT = 0.25;

export class SynthEngine {
  context: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  playing = false;
  onFailure: (message: string) => void = () => {};
  private patch: Patch = DEFAULT_PATCH;
  private volume = 0.4;
  private node: AudioWorkletNode | null = null;
  private master!: GainNode;
  private filter!: BiquadFilterNode;
  private wet!: GainNode;
  private delaySend!: GainNode;
  private feedback!: GainNode;
  private delay!: DelayNode;
  private filterDrift!: GainNode;
  private spaceDrift!: GainNode;
  private initializing: Promise<void> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  async unlock() {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("This browser does not support Web Audio.");
      this.context = new Ctor({ sampleRate: 48000 });
    }
    const ctx = this.context;
    // Resume during the click, before loading DSP, to retain gesture authorization.
    const resumed = ctx.resume();
    if (!this.node && !this.initializing) {
      this.initializing = this.setup(ctx).catch((error) => {
        this.close();
        throw error;
      }).finally(() => { this.initializing = null; });
    }
    await Promise.all([resumed, this.initializing]);
    if (this.context !== ctx || !this.node) throw new Error("The sound engine was closed. Press Play to try again.");
  }
  private async setup(ctx: AudioContext) {
    if (!ctx.audioWorklet) throw new Error("This browser needs AudioWorklet support. Try a current browser over HTTPS.");
    const compile = async (name: string) => {
      const response = await fetch(`/audio/${name}.wasm?v=2`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("The sound engine could not load. Please try again.");
      return WebAssembly.compile(await response.arrayBuffer());
    };
    const [plaits, marbles] = await Promise.all([
      compile("plaits"), compile("marbles"),
      ctx.audioWorklet.addModule("/audio/semantic-processor.js?v=4"),
    ]);
    if (this.context !== ctx) return;
    const node = new AudioWorkletNode(ctx, "semantic-instrument", {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { plaits, marbles, patch: this.patch },
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("The sound engine took too long to start. Please try again.")), 10000);
      node.port.onmessage = ({ data }) => {
        if (data.type === "ready") { clearTimeout(timeout); resolve(); }
      };
      node.onprocessorerror = () => {
        clearTimeout(timeout);
        reject(new Error("The sound engine could not start. Please reload and try again."));
      };
    });
    if (this.context !== ctx) { node.disconnect(); return; }
    this.node = node;
    node.onprocessorerror = () => {
      this.stop();
      this.onFailure("The sound engine stopped. Reload the page to restart it.");
    };
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.6;
    node.connect(this.filter);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    this.filter.connect(compressor);
    const reverb = ctx.createConvolver();
    const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 5.2), ctx.sampleRate);
    let seed = 271828;
    for (let channel = 0; channel < 2; channel++) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        samples[i] = (seed / 4294967296 * 2 - 1) * Math.pow(1 - i / samples.length, 2.6);
      }
    }
    reverb.buffer = impulse;
    this.wet = ctx.createGain();
    this.filter.connect(reverb);
    reverb.connect(this.wet);
    this.wet.connect(compressor);
    this.delay = ctx.createDelay(2);
    this.feedback = ctx.createGain();
    this.delaySend = ctx.createGain();
    this.filter.connect(this.delaySend);
    this.delaySend.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(compressor);
    this.filterDrift = ctx.createGain();
    const toneLfo = ctx.createOscillator();
    toneLfo.frequency.value = 1 / 53;
    toneLfo.connect(this.filterDrift);
    this.filterDrift.connect(this.filter.detune);
    toneLfo.start();
    this.spaceDrift = ctx.createGain();
    const spaceLfo = ctx.createOscillator();
    spaceLfo.frequency.value = 1 / 71;
    spaceLfo.connect(this.spaceDrift);
    this.spaceDrift.connect(this.wet.gain);
    spaceLfo.start();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    compressor.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.update(this.patch);
  }
  update(patch: Patch) {
    this.patch = patch;
    if (!this.context || !this.node) return;
    this.node.port.postMessage({ type: "patch", patch });
    const t = this.context.currentTime;
    this.filter.frequency.setTargetAtTime(450 * Math.pow(32, patch.brightness), t, PATCH_TIME_CONSTANT);
    this.wet.gain.setTargetAtTime(patch.space * 0.8, t, PATCH_TIME_CONSTANT);
    this.delaySend.gain.setTargetAtTime(patch.space * 0.2, t, PATCH_TIME_CONSTANT);
    this.feedback.gain.setTargetAtTime(0.08 + patch.space * 0.3, t, PATCH_TIME_CONSTANT);
    this.delay.delayTime.setTargetAtTime(Math.min(1.5, 60 / this.bpm * 0.75), t, PATCH_TIME_CONSTANT);
    this.filterDrift.gain.setTargetAtTime(patch.drift * 850, t, PATCH_TIME_CONSTANT);
    this.spaceDrift.gain.setTargetAtTime(patch.drift * patch.space * 0.2, t, PATCH_TIME_CONSTANT);
  }
  get bpm() { return Math.round(32 + this.patch.energy * 152); }
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.playing ? this.volume * 0.85 : 0, this.context.currentTime, 0.035);
  }
  start() {
    if (!this.context || !this.node) throw new Error("The sound engine is still loading. Try Play again.");
    if (this.playing) return;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.playing = true;
    this.node.port.postMessage({ type: "play", playing: true });
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.setVolume(this.volume);
  }
  stop() {
    this.playing = false;
    if (!this.context || !this.node) return;
    const node = this.node;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.015);
    this.stopTimer = setTimeout(() => node.port.postMessage({ type: "play", playing: false }), 100);
  }
  close() {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.playing = false;
    this.node?.disconnect();
    this.node = null;
    void this.context?.close();
    this.context = null;
    this.analyser = null;
  }
}
