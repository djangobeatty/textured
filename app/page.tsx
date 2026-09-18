"use client";

import { ArrowUpRight, Play, Square, Volume2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { BrowserCheck } from "@/components/browser-check";
import { Knob } from "@/components/knob";
import { VoiceBlend } from "@/components/voice-blend";
import { Scope } from "@/components/scope";
import { DescriptionHeader } from "@/components/description-header";
import { useInstrument } from "@/hooks/use-instrument";
import { usePlayerLocation } from "@/hooks/use-player-location";
import { useEmbedBridge } from "@/hooks/use-embed-bridge";
import { useInstrumentTools } from "@/hooks/use-instrument-tools";
import {
  DEFAULT_PATCH, EXAMPLES, dimensionKeys, engineKeys, engineLabels,
  gestures, harmonies, scaleKeys, scaleLabels,
  type Harmony, type Gesture, type Scale, type Dimension,
} from "@/lib/semantic";

const labels: Record<Dimension, string> = {
  energy: "Energy",
  brightness: "Brightness",
  tension: "Tension",
  space: "Space",
  movement: "Movement",
  texture: "Texture",
  drift: "Slow shifts",
};
const mappings: Record<Dimension, string> = {
  energy: "Tempo + rhythmic density",
  brightness: "Low-pass filter cutoff",
  tension: "Harmonic complexity + dissonance",
  space: "Reverb + echo",
  movement: "Pattern mutation + pitch spread + modulation",
  texture: "Timbre + morph + saturation",
  drift: "Slow overlapping shifts in timbre, harmonics and space",
};

export default function Home() {
  const initial = usePlayerLocation();
  const instrument = useInstrument(initial);
  const { embedded } = initial;
  const {
    description, patch, patchTitle, source, result, playing, volume, engine,
    loading, audioLoading, configured, browserCheck, checkingBrowser, usage,
    quotaExhausted, error, interpret, editDescription, togglePlay,
    manualPatch, manual, chooseExample, changeVolume,
  } = instrument;
  useEmbedBridge(embedded, initial.url, instrument.pause);
  useInstrumentTools(instrument);
  const modeText =
    source === "live" && result
      ? `${result.model} · 11 judgments · ${result.elapsedMs} ms${result.cached ? " · cached ≤5m" : ""}`
      : source === "shared"
        ? "Shared patch · saved settings"
        : source === "manual"
          ? "Your mix · controls adjusted by hand"
          : "Initial example · hand-tuned patch";
  return (
    <main className={`instrument${embedded ? " is-embedded" : ""}`}>
      <header className="masthead">
        <div className="identity">
          <h1>Textured<span>.</span></h1>
          <p className="tagline">Sounds of words.</p>
          <a className="studio-credit" href="https://fluxus.io/" target="_blank" rel="noreferrer">Fluxus <span>/ AI product studio</span></a>
        </div>
      </header>
      <section className="workspace">
        <div className="composer">
          <DescriptionHeader key={description} description={description} />
          <label htmlFor="description" className="field-label">Describe a sound.</label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => editDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void interpret(description, true).catch(() => {});
              }
            }}
            maxLength={400}
            className="prompt"
          />
          <div className="prompt-foot">
            <span>
              {playing
                ? "Edits reshape the sound as you type."
                : "A scene, a feeling, an impossible thing."}
            </span>
            <span>{description.length}/400</span>
          </div>
          <Button
            className="interpret"
            disabled={loading || audioLoading || quotaExhausted || !description.trim()}
            onClick={() => void interpret(description, true).catch(() => {})}
          >
            {quotaExhausted ? "Daily allowance reached" : audioLoading ? "Waking the instrument…" : checkingBrowser ? "Checking your browser…" : loading
              ? "Interpreting…"
              : playing
                ? "Reshape the sound"
                : "Make sound"}
            {loading || audioLoading ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <ArrowUpRight />
            )}
          </Button>
          <BrowserCheck request={browserCheck} />
          {usage && <p className="usage-note" aria-live="polite">
            <span>{usage.remaining} of {usage.limit} descriptions left today</span>
            <span>Resets 00:00 UTC · per browser</span>
          </p>}
          <p className="mode-note" aria-live="polite">
            {configured === false
              ? "TypeSafe is not connected. Play the initial patch or move the controls."
              : checkingBrowser ? "Complete the browser check below if asked." : loading
                ? "Finding the voices, character and motion…"
                : modeText}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="help-line">
            TypeSafe sets the controls from your words. Adjust any control to make it yours.
          </p>
        </div>
        <div className="synth">
          <div className="section-heading sound-heading"><span className="section-number">02</span><span>Shape the sound</span></div>
          <Scope engine={engine} playing={playing} />
          <div className="transport">
            <Button
              className="play"
              aria-label={playing ? "Stop synthesiser" : "Play synthesiser"}
              disabled={audioLoading && !playing}
              onClick={() => void togglePlay()}
            >
              {playing ? (
                <Square fill="currentColor" size={16} />
              ) : (
                <Play fill="currentColor" size={18} />
              )}{" "}
              {playing ? "Stop" : audioLoading ? "Loading…" : "Play"}
            </Button>
            <div className="patch-name">
              <span>
                {Math.round(32 + patch.energy * 152)} BPM /{" "}
                C {scaleLabels[patch.scale].toUpperCase()}
              </span>
              <strong title={patchTitle}>{patchTitle}</strong>
            </div>
            <div className="volume">
              <Volume2 size={18} />
              <Slider
                aria-label="Volume"
                value={[volume]}
                onValueChange={([value]) => changeVolume(value)}
              />
            </div>
          </div>
          <VoiceBlend engines={patch.engines} onChange={engines => manualPatch({ engines })} />
          <div className="voice-controls">
            <label>Playing style
              <select aria-label="Playing style" value={patch.gesture} onChange={e => manualPatch({ gesture: e.target.value as Gesture })}>
                {gestures.map(key => <option key={key} value={key}>{key === "drone" ? "Sustained" : key === "pulse" ? "Pulsing" : "Plucked"}</option>)}
              </select>
            </label>
            <label>Scale
              <select aria-label="Scale" value={patch.scale} onChange={e => manualPatch({ scale: e.target.value as Scale })}>
                {scaleKeys.map(key => <option key={key} value={key}>{scaleLabels[key]}</option>)}
              </select>
            </label>
            <label>Chord colour
              <select aria-label="Chord colour" value={patch.harmony} onChange={e => manualPatch({ harmony: e.target.value as Harmony })}>
                {harmonies.map(key => <option key={key} value={key}>{key.charAt(0).toUpperCase() + key.slice(1)}</option>)}
              </select>
            </label>
          </div>
          <div className="control-header">
            <span>Character</span>
            <span>Drag to turn · Shift for fine control</span>
          </div>
          <div className="knob-grid">
            {dimensionKeys.filter(key => key !== "drift").map((key) => (
              <div className="control" key={key} title={mappings[key]}>
                <span className="control-name">{labels[key]}</span>
                <Knob label={labels[key]} value={Math.round(patch[key] * 100)} defaultValue={Math.round(DEFAULT_PATCH[key] * 100)} onChange={(value) => manual(key, value)} />
                <span className="control-value">
                  {Math.round(patch[key] * 100)}
                </span>
              </div>
            ))}
          </div>
          <div className="drift-control">
            <div><label htmlFor="slow-shifts">Slow shifts</label><span>Gradual changes in tone and space.</span></div>
            <Slider id="slow-shifts" aria-label="Slow shifts" value={[Math.round(patch.drift * 100)]} onValueChange={v => manual("drift", v[0])} />
            <output>{Math.round(patch.drift * 100)}</output>
          </div>
          <details className="interpretation-details">
            <summary>How the words become sound</summary>
            <p>TypeSafe sets seven continuous controls: the six Character knobs and Slow shifts. It also chooses the sound families, playing style, chord colour and scale.</p>
            <p>The two strongest sound-family probabilities become voices A and B, balanced in proportion. The Voice blend fader changes their audible balance. All controls are editable; a new description sets them again.</p>
            {result ? <>
              <h3>Original TypeSafe interpretation</h3>
              <p className="help-line">These are the model’s original values{source === "manual" ? "; your manual adjustments are shown in the controls above" : ""}.</p>
              <dl className="model-values">
                {dimensionKeys.map(key => <div key={key}><dt>{labels[key]}</dt><dd>{Math.round(result.patch[key] * 100)} / 100</dd></div>)}
              </dl>
              <h3 id="probability-title">Sound-family probabilities</h3>
              <p className="help-line">TypeSafe’s original judgment of how well each family fits. Use Voice blend above to adjust the sound.</p>
              <figure className="probability-chart" aria-labelledby="probability-title">
                <div className="chart-axis" aria-hidden="true"><span>0</span><span>50</span><span>100%</span></div>
                {engineKeys.map(key => <div className="probability-row" key={key} role="img" aria-label={`${engineLabels[key]}: ${(result.patch.engines[key] * 100).toFixed(1)} percent`}>
                  <span className="probability-label">{engineLabels[key]}</span>
                  <div className="probability-plot" aria-hidden="true"><span style={{ width: `${result.patch.engines[key] * 100}%` }} /></div>
                  <span className="probability-value">{Math.round(result.patch.engines[key] * 100)}%</span>
                </div>)}
              </figure>
            </> : <p>Make a sound from a description to see TypeSafe’s original values here. The initial sound is a hand-tuned example.</p>}
            <p>Slow shifts unfold over tens of seconds. Movement varies the phrase; Texture changes the timbre. Notes follow your selected scale.</p>
            <p>Web Audio makes the audio in your browser. <a href="https://typesafe.ai" target="_blank" rel="noreferrer">TypeSafe</a> interprets the description; it does not hear or generate the audio.</p>
            <p>Built with Émilie Gillet’s Plaits and Marbles. <a href="/audio/NOTICE.txt" target="_blank" rel="noreferrer">Open-source credits ↗</a></p>
          </details>
        </div>
      </section>
      <section className="examples">
        <div className="examples-heading">
          <span className="eyebrow">Try a different world</span>
          <span>A few starting points.</span>
        </div>
        <div className="example-grid">
          {EXAMPLES.map((text, i) => (
            <Button
              key={text}
              className={`example ${patchTitle === text ? "selected" : ""}`}
              variant="ghost"
              onClick={() => chooseExample(text)}
            >
              <span className="example-number">0{i + 1}</span>
              <span>{text}</span>
              <ArrowUpRight size={16} />
            </Button>
          ))}
        </div>
      </section>
      <footer>
        <span>A toy from <a href="https://fluxus.io/" target="_blank" rel="noreferrer">FLUXUS</a></span>
        <div className="tools">
          <a
            href="https://docs.typesafe.ai/primitives/score"
            target="_blank"
            rel="noreferrer"
          >
            About TypeSafe ↗
          </a>
        </div>
      </footer>
    </main>
  );
}
