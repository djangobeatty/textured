'use client';

import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { engineKeys, engineLabels, type Engine, type Patch } from '@/lib/semantic';
import { blendEngines, readVoiceBlend, type VoiceBlend as Blend } from '@/lib/voice-blend';

export function VoiceBlend({ engines, onChange }: {
  engines: Patch['engines']; onChange: (engines: Patch['engines']) => void;
}) {
  const [blend, setBlend] = useState(() => readVoiceBlend(engines));
  const edited = useRef<Patch['engines'] | null>(null);
  useEffect(() => {
    // Keep A/B in place as the fader crosses its midpoint or reaches solo.
    // A fresh interpretation replaces both voices and their starting balance.
    if (engines !== edited.current) setBlend(readVoiceBlend(engines));
  }, [engines]);
  const update = (next: Blend) => {
    setBlend(next);
    edited.current = blendEngines(next);
    onChange(edited.current);
  };
  return <div className="voice-blend">
    <div className="section-heading"><span>Voice blend</span><span className="section-note">Two voices, one sound</span></div>
    <div className="voice-selectors">
      {(['a', 'b'] as const).map(side => <label key={side}>
        <span className="voice-label"><b>{side.toUpperCase()}</b> {side === 'a' ? 'First voice' : 'Second voice'}</span>
        <select aria-label={`Voice ${side.toUpperCase()}`} value={blend[side]} onChange={event => update({ ...blend, [side]: event.target.value as Engine })}>
          {engineKeys.map(key => <option key={key} value={key} disabled={key === blend[side === 'a' ? 'b' : 'a']}>{engineLabels[key]}</option>)}
        </select>
      </label>)}
    </div>
    <div className="blend-fader">
      <span>A <output>{Math.round((1 - blend.mix) * 100)}%</output></span>
      <Slider aria-label="Voice blend" aria-valuetext={`${Math.round((1 - blend.mix) * 100)} percent ${engineLabels[blend.a]}, ${Math.round(blend.mix * 100)} percent ${engineLabels[blend.b]}`} value={[blend.mix * 100]} onValueChange={([value]) => update({ ...blend, mix: value / 100 })} />
      <span><output>{Math.round(blend.mix * 100)}%</output> B</span>
    </div>
  </div>;
}
